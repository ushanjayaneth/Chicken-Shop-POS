import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getCoconutStockBalances, validateCoconutLedger} from '../lib/coconut-ledger.mjs';
import {applyCloudCommit} from '../lib/cloud-commit.mjs';
const firstDate = '2026-11-14';
const nextDate = '2026-11-15';
const sample = () => ({
  coconut_purchases: {purchase: {date: firstDate, largeCount: 10, smallCount: 2}},
  coconut_workers: {worker: {name: 'Worker'}},
  coconut_husking: {}, coconut_copra: {}, coconut_oil: {}, coconut_sales: {}, coconut_worker_payments: {}, cash_movements: {}
});
const command = (id, updates) => ({id, updates});
const isConflict = error => error.status === 409 && error.code === 'SYNC_CONFLICT';

test('simultaneous coconut depletion rejects the overdraw atomically with linked cash unchanged', () => {
  const original = sample();
  const husking = id => command(id, {
    ['coconut_husking/' + id]: {date: nextDate, workerId: 'worker', largeCount: 6, total: 18, paidDrawer: 18},
    ['cash_movements/' + id]: {date: nextDate, type: 'out', amount: 18, source: 'coconut_husk'}
  });
  const first = applyCloudCommit(original, husking('husk_first')).snapshot;
  assert.equal(getCoconutStockBalances(first).rawLargeStock, 4);
  assert.throws(() => applyCloudCommit(first, husking('husk_second')), isConflict);
  assert.equal(first.coconut_husking.husk_second, undefined);
  assert.equal(first.cash_movements.husk_second, undefined);
  assert.equal(Object.keys(first.cash_movements).length, 1);
});

test('peeled, husks, measured copra, oil and poonac stocks preserve their units and limits', () => {
  const original = sample();
  Object.assign(original, {
    coconut_husking: {husk: {date: firstDate, workerId: 'worker', largeCount: 6, total: 18, paidDrawer: 0}},
    coconut_copra: {copra: {date: firstDate, nutsUsed: 4, copraKg: 2}},
    coconut_oil: {oil: {date: firstDate, copraUsed: 1, oilQty: .6, poonacQty: .3}}
  });
  assert.deepEqual(getCoconutStockBalances(original), {
    rawLargeStock: 4, rawSmallStock: 2, peeledStock: 2, husksStock: 6,
    copraStock: 1, oilStock: .6, poonacStock: .3,
    copraStockKnown: true, copraUnknownBatches: 0, workerOutstanding: {worker: 18}
  });
  for (const [type, qty] of [['husked', 3], ['husks', 7], ['copra', 1.1], ['oil', .7], ['poonac', .4], ['unhusked', 5]]) {
    assert.throws(() => applyCloudCommit(original, command('oversale_' + type, {
      ['coconut_sales/' + type]: {date: nextDate, type, qty, price: 100, total: qty * 100}
    })), isConflict);
  }
  const shellSale = applyCloudCommit(original, command('shell_memo', {
    'coconut_sales/shell': {date: nextDate, type: 'shells', qty: 5, price: 10, total: 50}
  }));
  assert.equal(shellSale.snapshot.coconut_sales.shell.qty, 5);
});

test('forward and backdated dependency checks protect supplies used by later transactions', () => {
  const original = sample();
  original.coconut_husking.husk = {date: nextDate, workerId: 'worker', largeCount: 4, total: 12};
  assert.throws(() => applyCloudCommit(original, command('delete_supply', {'coconut_purchases/purchase': null})), isConflict);
  assert.throws(() => applyCloudCommit(original, command('move_supply', {'coconut_purchases/purchase/date': '2026-11-16'})), isConflict);
  assert.throws(() => applyCloudCommit(original, command('backdate_sale', {
    'coconut_sales/too_early': {date: '2026-11-13', type: 'unhusked', qty: 1, total: 100}
  })), isConflict);
  const reversal = applyCloudCommit(original, command('reverse_both', {
    'coconut_husking/husk': null, 'coconut_purchases/purchase': null
  }));
  assert.equal(getCoconutStockBalances(reversal.snapshot).rawLargeStock, 0);
});

test('legacy missing copra yield blocks new consumption until a measured output is recorded', () => {
  const original = sample();
  original.coconut_husking.husk = {date: firstDate, largeCount: 4, total: 0};
  original.coconut_copra.legacy = {date: firstDate, nutsUsed: 4};
  assert.equal(getCoconutStockBalances(original).copraStockKnown, false);
  assert.throws(() => applyCloudCommit(original, command('unknown_use', {
    'coconut_oil/oil': {date: nextDate, copraUsed: 1, oilQty: .6, poonacQty: .3}
  })), isConflict);
  const measured = applyCloudCommit(original, command('measure_and_use', {
    'coconut_copra/legacy/copraKg': 2,
    'coconut_oil/oil': {date: nextDate, copraUsed: 1, oilQty: .6, poonacQty: .3}
  }));
  assert.equal(getCoconutStockBalances(measured.snapshot).copraStock, 1);
});

test('concurrent wage payments and husking deletion preserve earned outstanding balances', () => {
  const original = sample();
  original.coconut_husking.husk = {date: firstDate, workerId: 'worker', largeCount: 5, total: 100, paidDrawer: 10};
  const payment = (id, amount) => command(id, {
    ['coconut_worker_payments/' + id]: {date: nextDate, workerId: 'worker', amount}
  });
  const first = applyCloudCommit(original, payment('wage_first', 60)).snapshot;
  assert.equal(getCoconutStockBalances(first).workerOutstanding.worker, 30);
  assert.throws(() => applyCloudCommit(first, payment('wage_excess', 40)), isConflict);
  assert.throws(() => applyCloudCommit(first, command('remove_earned', {'coconut_husking/husk': null})), isConflict);
  assert.throws(() => applyCloudCommit(first, command('backdate_wage', {
    'coconut_worker_payments/early': {date: '2026-11-13', workerId: 'worker', amount: 1}
  })), isConflict);
  const paid = applyCloudCommit(first, payment('wage_final', 30)).snapshot;
  assert.equal(getCoconutStockBalances(paid).workerOutstanding.worker, 0);
});

test('pre-existing negative balances may improve without blocking unrelated valid records', () => {
  const original = sample();
  original.coconut_husking.old = {date: firstDate, workerId: 'worker', largeCount: 12, total: 100, paidDrawer: 0};
  original.coconut_worker_payments.old = {date: firstDate, workerId: 'worker', amount: 110};
  const fixed = applyCloudCommit(original, command('repair_legacy', {
    'coconut_purchases/more': {date: firstDate, largeCount: 1},
    'coconut_worker_payments/old/amount': 105
  })).snapshot;
  assert.equal(getCoconutStockBalances(fixed).rawLargeStock, -1);
  assert.equal(getCoconutStockBalances(fixed).workerOutstanding.worker, -5);
  assert.throws(() => applyCloudCommit(fixed, command('worsen_legacy', {
    'coconut_worker_payments/new': {date: nextDate, workerId: 'worker', amount: 1}
  })), isConflict);
  assert.doesNotThrow(() => validateCoconutLedger(original, original, {'settings/main/shopName': 'Sample'}));
});
