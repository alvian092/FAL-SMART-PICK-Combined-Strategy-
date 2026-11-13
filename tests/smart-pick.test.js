import test from "node:test";
import assert from "node:assert/strict";
import { rankSmartPicks } from "../src/smart-pick.js";

const matrix = [[0.1, 0.2], [0.2, 0.5]];

test("Smart Pick ranks eligible candidates by EV then positive-return probability", () => {
  const result = rankSmartPicks(matrix, [
    { id: "lower-ev", descriptor: { type: "btts", selection: "yes" }, odds: 2.2 },
    { id: "higher-ev", descriptor: { type: "1x2", selection: "draw" }, odds: 2.5 },
    { id: "missing", descriptor: { type: "btts", selection: "yes" } }
  ], { minProbability: 0.1, minExpectedValue: -0.5, maxStakeFraction: 0.02 });
  assert.equal(result.status, "BET");
  assert.equal(result.ranked[0].id, "higher-ev");
  assert.equal(result.ranked[0].rank, 1);
  assert.ok(result.ranked[0].expectedValue >= result.ranked[1].expectedValue);
  assert.ok(result.ranked.every((pick) => pick.stakeFraction <= 0.02));
  assert.match(result.ranked[0].explanation.join(" "), /EV .*minimum/i);
  assert.match(result.ranked[0].explanation.join(" "), /probabilitas hasil positif .*minimum/i);
  assert.equal(result.rejected.find((pick) => pick.id === "missing").eligible, false);
});

test("Smart Pick enforces EV and probability thresholds and returns mandatory NO BET", () => {
  const result = rankSmartPicks(matrix, [
    { id: "weak", descriptor: { type: "1x2", selection: "away" }, odds: 1.5 },
    { id: "short-price", descriptor: { type: "btts", selection: "yes" }, odds: 1.2 }
  ], { minProbability: 0.95, minExpectedValue: 0.1 });
  assert.equal(result.status, "NO_BET");
  assert.equal(result.best, null);
  assert.equal(result.ranked.length, 0);
  assert.match(result.reason, /NO BET/i);
  assert.ok(result.rejected.every((pick) => pick.reasons.length > 0));
});

test("Smart Pick applies fractional Kelly and hard bankroll stake cap", () => {
  const result = rankSmartPicks(matrix, [
    { descriptor: { type: "1x2", selection: "draw" }, odds: 3.5 }
  ], { minProbability: 0.1, minExpectedValue: -1, fractionalKelly: 0.5, maxStakeFraction: 0.01 });
  assert.equal(result.status, "BET");
  assert.equal(result.best.stakeFraction, 0.01);
  assert.ok(result.best.reasons.some((reason) => /dibatasi/i.test(reason)));
});

test("Smart Pick rejects prices outside the configured risk window", () => {
  const result = rankSmartPicks(matrix, [
    { descriptor: { type: "1x2", selection: "home" }, odds: 25 }
  ], { minProbability: 0, minExpectedValue: -1, maxOdds: 10 });
  assert.equal(result.status, "NO_BET");
  assert.ok(result.rejected[0].reasons.some((reason) => /odds di luar batas/i.test(reason)));
});

test("Smart Pick validates thresholds and market candidates", () => {
  assert.throws(() => rankSmartPicks(matrix, [], { minProbability: 1.1 }), /between 0 and 1/i);
  assert.throws(() => rankSmartPicks(matrix, [], { maxStakeFraction: 0.06 }), /hard 5% bankroll cap/i);
  assert.throws(() => rankSmartPicks(matrix, [null]), /requires a market descriptor/i);
});

test("Smart Pick uses positive-return probability as the EV tie-breaker", () => {
  const result = rankSmartPicks(matrix, [
    { id: "lower-probability", descriptor: { type: "1x2", selection: "home" }, odds: 7 },
    { id: "higher-probability", descriptor: { type: "1x2", selection: "draw" }, odds: 7 / 3 }
  ], { minProbability: 0.1, minExpectedValue: 0.39, maxStakeFraction: 0.02 });
  assert.equal(result.status, "BET");
  assert.equal(result.ranked[0].id, "higher-probability");
  assert.equal(result.ranked[1].id, "lower-probability");
  assert.ok(Math.abs(result.ranked[0].expectedValue - result.ranked[1].expectedValue) < 1e-12);
});
