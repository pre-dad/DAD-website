// Unit tests for the map's scoring (dad/map/js/scoring.js). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndex, computeGap, severityCol } from '../dad/map/js/scoring.js';

const data = (cols, count = Object.values(cols)[0].length) => ({
  count,
  indicators: Object.fromEntries(Object.entries(cols).map(([k, sev]) => [k, { sev }])),
});

test('index is the weighted mean of severities', () => {
  const d = data({ a: [100, 0], b: [0, 0] });
  const { scores } = computeIndex(d, { a: 75, b: 25 });
  assert.deepEqual([...scores], [75, 0]);
});

test('index renormalises over the data a county has', () => {
  const d = data({ a: [80, 80], b: [20, null] });
  const { scores, completeness } = computeIndex(d, { a: 50, b: 50 });
  assert.equal(scores[0], 50);
  assert.equal(scores[1], 80);
  assert.equal(completeness[1], 0.5);
});

test('a county with under half the requested weight measured has no score', () => {
  const d = data({ a: [90, 90], b: [10, null], c: [10, null] });
  const { scores, completeness } = computeIndex(d, { a: 20, b: 40, c: 40 });
  assert.ok(Number.isFinite(scores[0]));
  assert.ok(Number.isNaN(scores[1]));
  assert.equal(completeness[1], 0.2);
});

test('exactly half the weight is enough', () => {
  const d = data({ a: [60], b: [null] });
  assert.equal(computeIndex(d, { a: 50, b: 50 }).scores[0], 60);
});

test('all-zero weights and unknown indicators score nothing', () => {
  const d = data({ a: [10, 20] });
  for (const weights of [{ a: 0 }, { missing: 100 }, {}]) {
    const { scores, keys } = computeIndex(d, weights);
    assert.deepEqual(keys, []);
    assert.ok([...scores].every(Number.isNaN));
  }
});

test('gap blends need and supply scarcity by the need share', () => {
  const d = data({ a: [100, 0], supply: [0, 100] });
  const w = { a: 100 };
  assert.deepEqual([...computeGap(d, w, 'supply', 60).scores], [60, 40]);
  assert.deepEqual([...computeGap(d, w, 'supply', 100).scores], [100, 0]);
  assert.deepEqual([...computeGap(d, w, 'supply', 0).scores], [0, 100]);
});

test('gap needs both halves: a missing supply value or need score gives no score', () => {
  const d = data({ a: [50, 50, null], supply: [null, 40, 40] });
  const { scores, missingSupply } = computeGap(d, { a: 100 }, 'supply', 50);
  assert.equal(missingSupply, false);
  assert.ok(Number.isNaN(scores[0]));
  assert.equal(scores[1], 45);
  assert.ok(Number.isNaN(scores[2]));
});

test('gap reports a supply layer that has not been built', () => {
  const d = data({ a: [50] });
  const r = computeGap(d, { a: 100 }, 'nope', 50);
  assert.equal(r.missingSupply, true);
  assert.ok(Number.isNaN(r.scores[0]));
  assert.equal(severityCol(d, 'nope'), null);
});
