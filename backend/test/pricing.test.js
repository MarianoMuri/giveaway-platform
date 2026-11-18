const test = require('node:test');
const assert = require('node:assert');
const { computeTotal, validatePromos } = require('../src/services/pricing');

const promos = [{ qty: 2, price: 15000 }, { qty: 5, price: 30000 }, { qty: 10, price: 50000 }];

test('combina promos al mejor precio', () => {
  assert.equal(computeTotal(10000, promos, 1).total, 10000);
  assert.equal(computeTotal(10000, promos, 2).total, 15000);
  assert.equal(computeTotal(10000, promos, 3).total, 25000); // 2 + 1
  assert.equal(computeTotal(10000, promos, 4).total, 30000); // 2 + 2
  assert.equal(computeTotal(10000, promos, 5).total, 30000);
  assert.equal(computeTotal(10000, promos, 7).total, 45000); // 5 + 2
  assert.equal(computeTotal(10000, promos, 10).total, 50000);
  const r = computeTotal(10000, promos, 13); // 10 + 2 + 1
  assert.equal(r.total, 75000);
  assert.equal(r.savings, 55000);
  assert.deepEqual(r.packs.map((p) => [p.qty, p.count]), [[10, 1], [2, 1], [1, 1]]);
});

test('sin promos cobra precio unitario', () => {
  assert.equal(computeTotal(5000, [], 3).total, 15000);
});

test('valida promos', () => {
  assert.throws(() => validatePromos([{ qty: 2, price: 1 }, { qty: 2, price: 2 }]));
  assert.deepEqual(validatePromos([{ qty: 5, price: '30000' }, { qty: 1, price: 9 }, { qty: 2, price: 15000 }]),
    [{ qty: 2, price: 15000 }, { qty: 5, price: 30000 }]);
});
