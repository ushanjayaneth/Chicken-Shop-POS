import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCloudCommit,commitToFirebase,CommitConflict} from '../lib/cloud-commit.mjs';
const stock=(quantity,id='a',costPrice=100)=>({batchId:id,quantity,costPrice});
const snapshot=()=>({items:{chicken:{stockBatches:[stock(5)]}},sales:{}});
function sale(id,before=5,after=3){return{id,guards:[{path:'items/chicken',expected:{stockBatches:[stock(before)]},before:{stockBatches:[stock(before)]}}],updates:{'items/chicken/stockBatches':[stock(after)],['sales/'+id]:{items:[{itemId:'chicken',qty:before-after,costPrice:100,costTotal:(before-after)*100}],total:400,profit:200,status:'completed'}}};}

test('two device stock deductions are merged and retried commands remain idempotent',()=>{
  const first=applyCloudCommit(snapshot(),sale('command_one')).snapshot;
  const second=applyCloudCommit(first,sale('command_two')).snapshot;
  assert.equal(second.items.chicken.stockBatches[0].quantity,1);
  assert.equal(Object.keys(second.sales).length,2);
  const retry=applyCloudCommit(second,sale('command_one'));
  assert.equal(retry.replayed,true);assert.equal(retry.snapshot.items.chicken.stockBatches[0].quantity,1);
});

test('cloud stock conflicts preserve the original snapshot instead of partially applying a bill',()=>{
  const first=applyCloudCommit(snapshot(),sale('command_one',5,1)).snapshot;
  assert.throws(()=>applyCloudCommit(first,sale('command_two',5,1)),CommitConflict);
  assert.equal(first.items.chicken.stockBatches[0].quantity,1);
  assert.equal(first.sales.command_two,undefined);
});

test('independent customer installments merge without clearing unpaid money',()=>{
  const original={loans:{loan:{totalAmount:100,paidAmount:0,paymentHistory:[],installments:[]}}};
  const payment=(id,amount)=>({id,guards:[{path:'loans/loan',expected:{paidAmount:0,paymentHistory:[]},before:original.loans.loan}],updates:{'loans/loan/paidAmount':amount,'loans/loan/paymentHistory':[{date:'2026-11-15T12:00:00Z',amount,note:id}],'loans/loan/installments':[],'loans/loan/status':'active'}});
  const first=applyCloudCommit(original,payment('payment_one',40)).snapshot;
  const second=applyCloudCommit(first,payment('payment_two',40)).snapshot;
  assert.equal(second.loans.loan.paidAmount,80);assert.equal(second.loans.loan.paymentHistory.length,2);
  assert.equal(second.loans.loan.status,'active');
  assert.throws(()=>applyCloudCommit(second,payment('payment_excess',30)),CommitConflict);
});

test('return quantities and exchange balances merge only within their remaining amounts',()=>{
  const original={sales:{bill:{items:[{qty:2}],total:100,returnItems:[],refundTotal:0},credit:{exchangeCreditRemaining:100,creditRedemptions:[]}}};
  const refund=id=>({id,guards:[{path:'sales/bill',expected:{returnItems:[],refundTotal:0},before:original.sales.bill}],updates:{'sales/bill/returnItems':[{sourceIndex:0,returnQty:1,refundAmount:50}],'sales/bill/refundTotal':50,'sales/bill/status':'partial_return'}});
  const first=applyCloudCommit(original,refund('refund_one')).snapshot;
  const second=applyCloudCommit(first,refund('refund_two')).snapshot;
  assert.equal(second.sales.bill.refundTotal,100);assert.equal(second.sales.bill.status,'returned');
  assert.throws(()=>applyCloudCommit(second,refund('refund_three')),CommitConflict);
  const redeem=id=>({id,guards:[{path:'sales/credit',expected:{exchangeCreditRemaining:100},before:original.sales.credit}],updates:{'sales/credit/exchangeCreditRemaining':50,'sales/credit/creditRedemptions':[{saleId:id,amount:50}]}});
  const third=applyCloudCommit(second,redeem('credit_one')).snapshot;
  const fourth=applyCloudCommit(third,redeem('credit_two')).snapshot;
  assert.equal(fourth.sales.credit.exchangeCreditRemaining,0);assert.equal(fourth.sales.credit.creditRedemptions.length,2);
  assert.throws(()=>applyCloudCommit(fourth,redeem('credit_three')),CommitConflict);
});

test('Firebase conditional writes retry a changed version and commit the original command exactly once',async()=>{
  let state=snapshot();let version=1;let raced=false;
  const request=async(_url,options)=>{
    if(!options.method)return{ok:true,status:200,headers:{get:()=>String(version)},json:async()=>structuredClone(state)};
    if(!raced){raced=true;state=applyCloudCommit(state,sale('other_device')).snapshot;version++;return{ok:false,status:412};}
    if(options.headers['if-match']!==String(version))return{ok:false,status:412};
    state=JSON.parse(options.body);version++;return{ok:true,status:200,json:async()=>state};
  };
  const result=await commitToFirebase('https://fixture.invalid',sale('command_one'),request);
  assert.equal(result.ok,true);assert.equal(state.items.chicken.stockBatches[0].quantity,1);
  const repeated=await commitToFirebase('https://fixture.invalid',sale('command_one'),request);
  assert.equal(repeated.replayed,true);assert.equal(state.items.chicken.stockBatches[0].quantity,1);
});
test('stock rebases across equal-cost batches while preserving recorded costs', () => {
  const initial = snapshot();
  initial.items.chicken.stockBatches = [stock(3), stock(4,'equal-cost')];
  const first = applyCloudCommit(initial,sale('command_first',3,1)).snapshot;
  const second = applyCloudCommit(first,sale('command_second',3,1)).snapshot;
  assert.deepEqual(second.items.chicken.stockBatches.map(batch=>batch.quantity), [0,3]);
  first.items.chicken.stockBatches[1].costPrice=200;
  assert.throws(()=>applyCloudCommit(first,sale('command_third',3,1)),CommitConflict);
});

test('concurrent writes preserve unique serial barcodes and do not rebase absolute counts', () => {
  const initial=snapshot();
  const previous={...stock(5),barcodes:['serial-one','serial-two']};
  initial.items.chicken.stockBatches=[previous];
  const command=id=>({
    id,
    guards:[{path:'items/chicken',expected:{stockBatches:[previous]}}],
    updates:{'items/chicken/stockBatches':[{...stock(4),barcodes:['serial-two']}]}
  });
  const first=applyCloudCommit(initial,command('serial_sale_a')).snapshot;
  assert.throws(()=>applyCloudCommit(first,command('serial_sale_b')),/already sold/);
  const counted=command('record_count');
  counted.updates['items/chicken/stockAdjustments']=[{reason:'Physical count',previous:5,quantity:4}];
  assert.throws(()=>applyCloudCommit(first,counted),/Review the pending count/);
});
