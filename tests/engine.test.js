import test from "node:test";
import assert from "node:assert/strict";
import { poissonPmf, scoreMatrix, matchProbabilities, fairOdds, expectedValue, noVigProbabilities } from "../src/engine.js";

test("Poisson lambda zero assigns all mass to zero goals", () => {
  assert.equal(poissonPmf(0, 0), 1);
  assert.equal(poissonPmf(1, 0), 0);
});

test("Poisson probabilities are valid and score matrix is normalized after truncation", () => {
  const matrix = scoreMatrix(1.4, 1.1, 15);
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  assert.ok(total > 0.999 && total <= 1.000001);
  assert.ok(matrix.flat().every((p) => p >= 0 && Number.isFinite(p)));
});

test("match markets are bounded and 1X2 sums to one", () => {
  const p = matchProbabilities(scoreMatrix(1.5, 1.0, 15));
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-10);
  for (const value of Object.values(p)) assert.ok(value >= 0 && value <= 1);
});

test("fair odds and expected value use decimal odds correctly", () => {
  assert.equal(fairOdds(0.5), 2);
  assert.equal(expectedValue(0.5, 2), 0);
  assert.equal(expectedValue(0.6, 2), 0.2);
});

test("no-vig probabilities sum to one", () => {
  const probabilities = noVigProbabilities([2, 3, 4]);
  assert.ok(Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("invalid model inputs are rejected", () => {
  assert.throws(() => poissonPmf(-1, 1), RangeError);
  assert.throws(() => scoreMatrix(9, 1), RangeError);
  assert.throws(() => fairOdds(0), RangeError);
  assert.throws(() => expectedValue(0.5, 1), RangeError);
});
