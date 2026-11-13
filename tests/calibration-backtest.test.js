import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTemperatureScaling,
  fitTemperatureScaling,
  walkForwardBacktest
} from "../src/engine.js";

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not close to ${b}`);

test("temperature 1 preserves probabilities and scaling always normalizes 1X2", () => {
  const probabilities = { home: 0.52, draw: 0.27, away: 0.21 };
  assert.deepEqual(applyTemperatureScaling(probabilities, 1), probabilities);
  const scaled = applyTemperatureScaling(probabilities, 1.8);
  close(scaled.home + scaled.draw + scaled.away, 1);
  assert.ok(scaled.home < probabilities.home);
  assert.throws(() => applyTemperatureScaling(probabilities, 0), /temperature/i);
  assert.throws(() => applyTemperatureScaling({ home: 0.5, draw: 0.2, away: 0.2 }, 1), /sum to one/i);
});

test("temperature fitting uses held-out outcomes and returns finite log-loss diagnostics", () => {
  const rows = Array.from({ length: 24 }, () => ({ home: 0.82, draw: 0.10, away: 0.08 }));
  const outcomes = Array.from({ length: 24 }, (_, index) => index % 3 === 0 ? "home" : "draw");
  const fit = fitTemperatureScaling(rows, outcomes, { minSamples: 10 });
  assert.ok(Number.isFinite(fit.temperature));
  assert.ok(fit.temperature > 0.05 && fit.temperature <= 10);
  assert.ok(Number.isFinite(fit.beforeLogLoss));
  assert.ok(Number.isFinite(fit.afterLogLoss));
  assert.equal(fit.sampleSize, 24);
  assert.throws(() => fitTemperatureScaling(rows.slice(0, 3), outcomes.slice(0, 3)), /at least 10/i);
  assert.throws(() => fitTemperatureScaling(rows, [...outcomes.slice(0, 23), "home-win"]), /outcome/i);
});

function makeHistory(count = 54) {
  const pairings = [
    ["A", "B", 2, 0], ["C", "D", 1, 1], ["B", "C", 0, 1],
    ["D", "A", 0, 2], ["A", "C", 1, 0], ["B", "D", 2, 2]
  ];
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const [homeTeam, awayTeam, homeGoals, awayGoals] = pairings[index % pairings.length];
    return {
      date: new Date(start + index * 86400000).toISOString().slice(0, 10),
      league: index % 2 ? "League B" : "League A",
      homeTeam, awayTeam, homeGoals, awayGoals
    };
  });
}

test("walk-forward forecasts are chronological and never train on same-day or future fixtures", () => {
  const history = makeHistory(48);
  // Same-day fixture must not be available to another fixture on that date.
  history.push({ ...history[47], homeTeam: "A", awayTeam: "D" });
  const result = walkForwardBacktest(history, {
    minTrainingMatches: 8, minTeamAppearances: 2, calibrationMinSamples: 4
  });
  assert.ok(result.evaluated > 0);
  assert.equal(result.totalValidFixtures, 49);
  for (const prediction of result.predictions) {
    assert.ok(prediction.trainingMatches < history.filter((m) => m.date < prediction.date).length + 1);
    assert.ok(prediction.trainingMatches >= 8);
    assert.ok(prediction.homeAppearances >= 2);
    assert.ok(prediction.awayAppearances >= 2);
    close(prediction.raw.home + prediction.raw.draw + prediction.raw.away, 1);
    close(prediction.calibrated.home + prediction.calibrated.draw + prediction.calibrated.away, 1);
  }
  assert.ok(result.calibrationSamples > 0);
  assert.ok(result.rawMetrics.logLoss >= 0);
  assert.ok(result.rawMetrics.brierScore >= 0);
  assert.ok(result.rawMetrics.accuracy >= 0 && result.rawMetrics.accuracy <= 1);
});

test("walk-forward records skipped fixtures when prior team history is insufficient", () => {
  const result = walkForwardBacktest(makeHistory(12), {
    minTrainingMatches: 10, minTeamAppearances: 20, calibrationMinSamples: 3
  });
  assert.equal(result.evaluated, 0);
  assert.ok(result.skippedCount > 0);
  assert.equal(result.rawMetrics, null);
  assert.ok(result.skipped.every((item) => item.reason === "insufficient_team_history" ||
    item.reason === "insufficient_prior_matches"));
});

test("walk-forward rejects invalid settings and never invents predictions for empty data", () => {
  assert.throws(() => walkForwardBacktest([], { minTrainingMatches: 0 }), /minTrainingMatches/i);
  assert.throws(() => walkForwardBacktest([], { calibrationMinSamples: 1 }), /calibrationMinSamples/i);
  const empty = walkForwardBacktest([]);
  assert.equal(empty.evaluated, 0);
  assert.equal(empty.skippedCount, 0);
  assert.equal(empty.rawMetrics, null);
});
