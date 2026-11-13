import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreMatrix,
  matchProbabilities,
  dixonColesScoreMatrix,
  estimateElo
} from "../src/engine.js";

const sum = (matrix) => matrix.flat().reduce((total, value) => total + value, 0);

test("Dixon-Coles rho zero matches the normalized independent Poisson baseline", () => {
  const baseline = scoreMatrix(1.45, 1.1, 12);
  const baselineTotal = sum(baseline);
  const corrected = dixonColesScoreMatrix(1.45, 1.1, 0, 12);
  assert.ok(Math.abs(sum(corrected) - 1) < 1e-12);
  corrected.forEach((row, h) => row.forEach((value, a) => {
    assert.ok(Math.abs(value - baseline[h][a] / baselineTotal) < 1e-12);
  }));
});

test("Dixon-Coles adjusts only the four low-score cells before normalization", () => {
  const home = 1.4;
  const away = 1.05;
  const rho = -0.08;
  const baseline = scoreMatrix(home, away, 12);
  const corrected = dixonColesScoreMatrix(home, away, rho, 12);
  const ratios = [
    corrected[0][0] / baseline[0][0],
    corrected[0][1] / baseline[0][1],
    corrected[1][0] / baseline[1][0],
    corrected[1][1] / baseline[1][1]
  ];
  const normalization = ratios[3] / (1 - rho);
  assert.ok(Math.abs(ratios[0] / normalization - (1 - home * away * rho)) < 1e-10);
  assert.ok(Math.abs(ratios[1] / normalization - (1 + home * rho)) < 1e-10);
  assert.ok(Math.abs(ratios[2] / normalization - (1 + away * rho)) < 1e-10);
  assert.ok(Math.abs(ratios[3] / normalization - (1 - rho)) < 1e-10);
  assert.ok(Math.abs(matchProbabilities(corrected).home +
    matchProbabilities(corrected).draw + matchProbabilities(corrected).away - 1) < 1e-12);
});

test("Dixon-Coles rejects invalid rho and correction factors that would be negative", () => {
  assert.throws(() => dixonColesScoreMatrix(1.2, 1.1, 1.1), /rho/i);
  assert.throws(() => dixonColesScoreMatrix(8, 8, -0.2), /correction factor/i);
  assert.throws(() => dixonColesScoreMatrix(1.2, 1.1, 0, 0), /maxGoals/i);
});

const history = [
  { date: "2025-01-03", homeTeam: "A", awayTeam: "B", homeGoals: 2, awayGoals: 0 },
  { date: "2025-01-01", homeTeam: "B", awayTeam: "C", homeGoals: 1, awayGoals: 0 },
  { date: "2025-01-02", homeTeam: "C", awayTeam: "A", homeGoals: 0, awayGoals: 1 },
  { date: "2025-01-04", homeTeam: "A", awayTeam: "B", homeGoals: 0, awayGoals: 0 }
];

test("Elo processes fixtures chronologically and returns reproducible ratings", () => {
  const first = estimateElo(history, "A", "B", { homeAdvantage: 0, kFactor: 20 });
  const shuffled = estimateElo([history[3], history[1], history[0], history[2]], "A", "B", {
    homeAdvantage: 0, kFactor: 20
  });
  assert.deepEqual(first.ratings, shuffled.ratings);
  assert.equal(first.matchesUsed, 4);
  assert.ok(first.homeRating > first.awayRating);
  assert.ok(first.expectedHomeScore > 0.5);
});

test("Elo excludes matches on or after the analysis date", () => {
  const result = estimateElo(history, "A", "B", {
    cutoffDate: "2025-01-04", homeAdvantage: 0
  });
  assert.equal(result.matchesUsed, 3);
  const withoutFuture = estimateElo(history.slice(0, 3), "A", "B", {
    homeAdvantage: 0
  });
  assert.deepEqual(result.ratings, withoutFuture.ratings);
});

test("Elo draw is neutral for equal ratings when home advantage is zero", () => {
  const result = estimateElo([{
    date: "2025-01-01", homeTeam: "A", awayTeam: "B", homeGoals: 1, awayGoals: 1
  }], "A", "B", { homeAdvantage: 0, kFactor: 20 });
  assert.equal(result.homeRating, 1500);
  assert.equal(result.awayRating, 1500);
  assert.equal(result.expectedHomeScore, 0.5);
});

test("Elo validates teams, options, and empty history", () => {
  assert.throws(() => estimateElo([], "A", "B"), /no valid historical/i);
  assert.throws(() => estimateElo(history, "A", "A"), /different/i);
  assert.throws(() => estimateElo(history, "A", "B", { kFactor: 0 }), /kFactor/i);
  assert.throws(() => estimateElo(history, "A", "B", { cutoffDate: "2025-02-30" }), /YYYY-MM-DD/i);
});
