import {z} from 'zod';
import type {Employee,Attendance,StaffTransaction,Payroll} from '../../../shared/staff.js';
import {staffBalance} from '../../../shared/staff.js';
import type {Shift,Expense} from '../../../shared/types.js';
import {now,uid,permitLocal,requireLocal,scopeLocal,type LocalRequest} from './types.js';
import {businessDate} from '../../../shared/costing.js';

const id=z.string().min(1).max(160),money=z.number().int().min(0).max(1_000_000_000),command=z.string().min(8).max(160).optional();
const profile=z.object({branchId:id,name:z.string().trim().min(2).max(120),phone:z.string().trim().max(30).default(''),position:z.string().trim().max(80).default(''),monthlySalary:money,active:z.boolean().default(true),commandId:command});
const financial=z.object({commandId:command,branchId:id,employeeId:id,method:z.enum(['cash','card','qr']),reference:z.string().trim().max(160).default(''),note:z.string().trim().max(500).default('')});
async function employee(request:LocalRequest,employeeId:string,branchId:string){await scopeLocal(request.store,request.user,branchId);const row=await request.store.get<Employee>('employee',employeeId);requireLocal(row&&row.branchId===branchId,'Employee not found in this branch.',404);return row!;}
async function cash(request:LocalRequest,branchId:string,delta:number){if(delta===0)return;const shift=(await request.store.list<Shift>('shift',branchId)).find(row=>row.status==='open');requireLocal(shift,'Open a cash shift first.',409,'SHIFT_REQUIRED');requireLocal(shift!.expectedCash+delta>=0,'There is not enough recorded cash in the drawer.',409,'INSUFFICIENT_CASH');await request.store.put('shift',{...shift!,expectedCash:shift!.expectedCash+delta});}
async function audit(request:LocalRequest,branchId:string,action:string,detail:string){await request.store.put('audit',{id:uid('audit'),branchId,action,actor:request.user.name,detail,createdAt:now()});}

/** The caller owns one IndexedDB transaction or one authoritative cloud CAS. */
export async function handleStaff(request:LocalRequest):Promise<unknown|undefined>{
 const {path,method,store,user}=request;if(!path.startsWith('/hr/'))return;
 permitLocal(user,['owner','manager','accountant']);
 const match=/^\/hr\/employees\/([^/]+)$/.exec(path);
 if(path==='/hr/employees'&&method==='POST'||match&&method==='PATCH'){
  const body=(match?profile.partial().extend({branchId:id}):profile).parse(request.body);await scopeLocal(store,user,body.branchId);
  const existing=match?await employee(request,match[1],body.branchId):undefined;
  const {commandId:_,...values}=body;const createdAt=existing?.createdAt??now();
  const row:Employee={...existing,...values,id:existing?.id??uid('employee'),createdAt,updatedAt:now()} as Employee;
  await store.put('employee',row);await audit(request,body.branchId,existing?'employee.updated':'employee.created',row.name);return {ok:true,employee:row};
 }
 if(path==='/hr/attendance'&&method==='POST'){
  const body=z.object({commandId:command,branchId:id,employeeId:id,date:z.iso.date(),status:z.enum(['present','absent','leave']),checkIn:z.iso.datetime().nullable().default(null),checkOut:z.iso.datetime().nullable().default(null),note:z.string().trim().max(500).default('')}).parse(request.body);
  const person=await employee(request,body.employeeId,body.branchId);requireLocal(person.active,'This employee is inactive.',409);
  requireLocal(body.status==='present'||body.checkIn===null&&body.checkOut===null,'Absent/leave entries cannot contain work times.');
  if(body.checkIn)requireLocal(businessDate(body.checkIn)===body.date,'Check-in must fall on the selected working day.');
  if(body.checkOut)requireLocal(body.checkIn&&Date.parse(body.checkOut)>=Date.parse(body.checkIn)&&Date.parse(body.checkOut)-Date.parse(body.checkIn)<=48*3600000,'Check-out must be after check-in and within 48 hours.');
  const row:Attendance={id:`attendance-${person.id}-${body.date}`,branchId:body.branchId,employeeId:person.id,date:body.date,status:body.status,checkIn:body.checkIn,checkOut:body.checkOut,note:body.note,updatedAt:now(),createdBy:user.id};
  await store.put('attendance',row);await audit(request,body.branchId,'attendance.recorded',`${person.name}: ${body.date} ${body.status}`);return {ok:true,attendance:row};
 }
 if(path==='/hr/transactions'&&method==='POST'){
  const body=financial.extend({account:z.enum(['advance','loan']),direction:z.enum(['issued','repaid']),amount:money.refine(value=>value>0)}).parse(request.body);
  const person=await employee(request,body.employeeId,body.branchId);requireLocal(person.active||body.direction==='repaid','This employee is inactive.',409);
  const entries=await store.list<StaffTransaction>('staffTransaction',body.branchId);
  if(body.direction==='repaid')requireLocal(body.amount<=staffBalance(entries,person.id,body.account),'Repayment exceeds the remaining balance.',409,'STAFF_OVERPAYMENT');
  if(body.method==='cash')await cash(request,body.branchId,body.direction==='issued'?-body.amount:body.amount);
  const row:StaffTransaction={id:uid('staff-entry'),branchId:body.branchId,employeeId:person.id,account:body.account,direction:body.direction,amount:body.amount,method:body.method,reference:body.reference,note:body.note,payrollId:null,createdAt:now(),createdBy:user.id};
  await store.put('staffTransaction',row);await audit(request,body.branchId,'staff.account',`${person.name}: ${body.account} ${body.direction} ${body.amount}`);return {ok:true,transaction:row};
 }
 if(path==='/hr/payroll'&&method==='POST'){
  const body=financial.extend({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),baseSalary:money,bonus:money.default(0),otherDeduction:money.default(0),advanceDeduction:money.default(0),loanDeduction:money.default(0)}).parse(request.body);
  const person=await employee(request,body.employeeId,body.branchId);requireLocal(person.active,'This employee is inactive.',409);
  const payrollId=`payroll-${person.id}-${body.period}`;requireLocal(!await store.get('payroll',payrollId),'Salary has already been recorded for this employee and month.',409,'PAYROLL_EXISTS');
  const entries=await store.list<StaffTransaction>('staffTransaction',body.branchId);
  requireLocal(body.advanceDeduction<=staffBalance(entries,person.id,'advance')&&body.loanDeduction<=staffBalance(entries,person.id,'loan'),'A payroll recovery exceeds the employee balance.',409,'STAFF_OVERPAYMENT');
  const gross=body.baseSalary+body.bonus,net=gross-body.otherDeduction-body.advanceDeduction-body.loanDeduction;
  requireLocal(Number.isSafeInteger(gross)&&gross>0&&gross<=1_000_000_000&&net>=0,'Check salary and deduction amounts.');
  if(body.method==='cash')await cash(request,body.branchId,-net);
  const row:Payroll={id:payrollId,branchId:body.branchId,employeeId:person.id,employeeName:person.name,period:body.period,baseSalary:body.baseSalary,bonus:body.bonus,otherDeduction:body.otherDeduction,advanceDeduction:body.advanceDeduction,loanDeduction:body.loanDeduction,gross,net,method:body.method,reference:body.reference,note:body.note,createdAt:now(),createdBy:user.id};
  await store.put('payroll',row);
  for(const [account,amount]of [['advance',body.advanceDeduction],['loan',body.loanDeduction]] as const)if(amount>0)await store.put<StaffTransaction>('staffTransaction',{id:`${payrollId}-${account}`,branchId:body.branchId,employeeId:person.id,account,direction:'repaid',amount,method:'payroll',payrollId,reference:body.period,note:'Recovered through monthly salary',createdAt:row.createdAt,createdBy:user.id});
  await store.put<Expense>('expense',{id:`${payrollId}-expense`,branchId:body.branchId,category:'Staff salaries',description:`Salary: ${person.name} / ${body.period}`,amount:gross,paymentMethod:'payroll',createdAt:row.createdAt,createdBy:user.id});
  await audit(request,body.branchId,'payroll.paid',`${person.name}: ${body.period} net ${net}`);return {ok:true,payroll:row};
 }
 return undefined;
}
