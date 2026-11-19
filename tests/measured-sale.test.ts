import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measurementUnit, measuredSaleQuantity, measuredSaleForBudget} from '../shared/measured-sale';
import {lineAmount, salePrice} from '../shared/retail';

test('grams and kilograms share the canonical stock quantity and per-kilogram charge', () => {
  assert.equal(measuredSaleQuantity(100, 'g', 'kg'), .1);
  assert.equal(measuredSaleQuantity(.5, 'kg', 'kg'), .5);
  assert.equal(lineAmount(30000, measuredSaleQuantity(100, 'g', 'kg')!), 3000);
  assert.equal(measuredSaleQuantity(.1, 'kg', 'g'), 100);
  assert.equal(measuredSaleQuantity(.125, 'g', 'g'), .125);
});

test('manual quantity preserves supported precision without silently changing the weighed amount', () => {
  assert.equal(measuredSaleQuantity(100.5, 'g', 'kg'), null);
  assert.equal(measuredSaleQuantity(.0001, 'kg', 'kg'), null);
  assert.equal(measuredSaleQuantity(1000, 'kg', 'kg'), 1000);
  assert.equal(measuredSaleQuantity(1000.001, 'kg', 'kg'), null);
  for (const value of [0, -1, NaN, Infinity]) assert.equal(measuredSaleQuantity(value, 'kg', 'kg'), null);
  assert.equal(measuredSaleQuantity(1, 'pcs', 'kg'), null);
  assert.equal(measuredSaleQuantity(1, 'kg', 'pcs'), null);
});

test('amount entry quotes an exact or lower affordable quantity at the selected selling price', () => {
  assert.deepEqual(measuredSaleForBudget(15000, 30000, 'kg'), {quantity: .5, amount: 15000, remainder: 0});
  assert.deepEqual(measuredSaleForBudget(10000, 30000, 'kg'), {quantity: .333, amount: 9990, remainder: 10});
  const wholesale = salePrice({price: 30000, wholesalePrice: 28200}, 'wholesale');
  assert.deepEqual(measuredSaleForBudget(14100, wholesale, 'kg'), {quantity: .5, amount: 14100, remainder: 0});
  assert.deepEqual(measuredSaleForBudget(15000, 30, 'g'), {quantity: 500, amount: 15000, remainder: 0});
});

test('budget calculations retain integer-minor-unit edges, stock limits and safe inputs', () => {
  assert.deepEqual(measuredSaleForBudget(3125, 24999, 'kg'), {quantity: .125, amount: 3125, remainder: 0});
  assert.deepEqual(measuredSaleForBudget(30000000, 30000, 'kg'), {quantity: 1000, amount: 30000000, remainder: 0});
  assert.equal(measuredSaleForBudget(30000030, 30000, 'kg'), null);
  for (const budget of [0, -1, 1, 29, .5, NaN, Infinity]) assert.equal(measuredSaleForBudget(budget, 30000, 'kg'), null);
  for (const price of [0, -1, 1.1, NaN, Infinity]) assert.equal(measuredSaleForBudget(10000, price, 'kg'), null);
  assert.equal(measuredSaleForBudget(10000, 30000, 'pcs'), null);
});

test('volume units and litre aliases retain existing measured-sale behavior', () => {
  assert.equal(measurementUnit('litre'), 'L');
  assert.equal(measurementUnit('LITER'), 'L');
  assert.equal(measuredSaleQuantity(250, 'ml', 'litre'), .25);
  assert.equal(measuredSaleQuantity(.25, 'L', 'ml'), 250);
  assert.deepEqual(measuredSaleForBudget(5000, 20000, 'liter'), {quantity: .25, amount: 5000, remainder: 0});
  assert.equal(measuredSaleQuantity(100, 'ml', 'kg'), null);
});