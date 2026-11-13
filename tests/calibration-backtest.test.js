import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTemperatureScaling,
  fitTemperatureScaling,
  walkForwardBacktest,
  calculateReliabilityBins,
  evaluatePerformanceByLeague,
  estimateProbabilityIntervals
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
  assert.equal(result.reliability.home.sampleSize, result.calibrationSamples);
  assert.equal(result.reliabilityRaw.home.sampleSize, result.evaluated);
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

test("reliability bins report observed frequency, ECE and MCE for all 1X2 outcomes", () => {
  const rows = [
    { raw: { home: 0.8, draw: 0.1, away: 0.1 }, calibrated: { home: 0.8, draw: 0.1, away: 0.1 }, actual: "home" },
    { raw: { home: 0.7, draw: 0.2, away: 0.1 }, calibrated: { home: 0.7, draw: 0.2, away: 0.1 }, actual: "draw" },
    { raw: { home: 0.2, draw: 0.6, away: 0.2 }, calibrated: { home: 0.2, draw: 0.6, away: 0.2 }, actual: "away" }
  ];
  const result = calculateReliabilityBins(rows, "raw", 5);
  assert.deepEqual(Object.keys(result), ["home", "draw", "away"]);
  assert.equal(result.home.sampleSize, 3);
  assert.equal(result.home.bins.length, 5);
  assert.ok(result.home.expectedCalibrationError >= 0 && result.home.expectedCalibrationError <= 1);
  assert.ok(result.home.maximumCalibrationError >= 0 && result.home.maximumCalibrationError <= 1);
  assert.equal(result.home.bins[3].count, 1);
  assert.equal(result.home.bins[3].observedRate, 0);
  assert.equal(result.home.bins[4].count, 1);
  assert.equal(result.home.bins[4].observedRate, 1);
  assert.throws(() => calculateReliabilityBins(rows, "unknown", 5), /probabilityKey/i);
  assert.throws(() => calculateReliabilityBins(rows, "raw", 1), /binCount/i);
});

test("per-league evaluation preserves separate out-of-sample scorecards and calibration sample counts", () => {
  const rows = [
    { league: "League B", actual: "home", raw: { home: 0.7, draw: 0.2, away: 0.1 }, calibrated: { home: 0.6, draw: 0.25, away: 0.15 }, calibrationStatus: "warming_up" },
    { league: "League A", actual: "draw", raw: { home: 0.2, draw: 0.6, away: 0.2 }, calibrated: { home: 0.2, draw: 0.6, away: 0.2 }, calibrationStatus: "fitted_on_prior_forecasts" },
    { league: "League A", actual: "away", raw: { home: 0.2, draw: 0.2, away: 0.6 }, calibrated: { home: 0.2, draw: 0.2, away: 0.6 }, calibrationStatus: "fitted_on_prior_forecasts" }
  ];
  const result = evaluatePerformanceByLeague(rows);
  assert.deepEqual(result.map((item) => item.league), ["League A", "League B"]);
  assert.equal(result[0].sampleSize, 2);
  assert.equal(result[0].calibrationSamples, 2);
  assert.equal(result[0].calibrationMetrics.sampleSize, 2);
  assert.equal(result[1].calibrationSamples, 0);
  assert.equal(result[1].calibrationMetrics, null);
  assert.equal(result[1].rawMetrics.sampleSize, 1);
  assert.throws(() => evaluatePerformanceByLeague(null), /array/i);
});

test("bootstrap uncertainty intervals are deterministic, bounded, and pre-date only", () => {
  const matches = [];
  for (let day = 1; day <= 24; day += 1) matches.push({
    date: `2025-01-${String(day).padStart(2, "0")}`,
    league: "Test League",
    homeTeam: day % 2 ? "Alpha" : "Beta",
    awayTeam: day % 2 ? "Beta" : "Alpha",
    homeGoals: day % 4 === 0 ? 0 : day % 3,
    awayGoals: day % 5 === 0 ? 2 : day % 2
  });
  const options = { cutoffDate: "2025-01-25", iterations: 60, confidenceLevel: 0.9, seed: 12345 };
  const first = estimateProbabilityIntervals(matches, "Alpha", "Beta", options);
  assert.deepEqual(first, estimateProbabilityIntervals(matches, "Alpha", "Beta", options));
  assert.equal(first.sampleSize, 24);
  assert.equal(first.successfulIterations + first.failedIterations, 60);
  for (const key of ["home", "draw", "away", "over25", "bttsYes"]) {
    assert.ok(first.intervals[key].lower >= 0 && first.intervals[key].upper <= 1);
    assert.ok(first.intervals[key].lower <= first.intervals[key].median && first.intervals[key].median <= first.intervals[key].upper);
  }
  assert.ok(first.intervals.lambdaHome.lower >= 0 && first.intervals.lambdaHome.upper <= 8);
  assert.throws(() => estimateProbabilityIntervals(matches, "Alpha", "Beta", { ...options, cutoffDate: "2025-01-24" }), /at least 5 prior appearances|at least 10/i);
  assert.throws(() => estimateProbabilityIntervals(matches, "Alpha", "Beta", { ...options, iterations: 10 }), /iterations/i);
});
