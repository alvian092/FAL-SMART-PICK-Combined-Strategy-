import test from "node:test";
import assert from "node:assert/strict";
import { walkForwardMarketBacktest } from "../src/market-backtest.js";

function history() {
  const rows = [];
  for (let day = 1; day <= 16; day += 1) {
    rows.push({
      date: `2025-01-${String(day).padStart(2, "0")}`,
      league: "Test League",
      homeTeam: day % 2 ? "Alpha" : "Beta",
      awayTeam: day % 2 ? "Beta" : "Alpha",
      homeGoals: day % 3 === 0 ? 0 : 2,
      awayGoals: day % 4 === 0 ? 1 : 0
    });
  }
  // Two fixtures on the same date must both use only dates 1–16.
  rows.push({ date: "2025-01-17", league: "Test League", homeTeam: "Alpha", awayTeam: "Beta", homeGoals: 2, awayGoals: 0 });
  rows.push({ date: "2025-01-17", league: "Test League", homeTeam: "Beta", awayTeam: "Alpha", homeGoals: 0, awayGoals: 1 });
  rows.push({ date: "2025-01-18", league: "Test League", homeTeam: "Alpha", awayTeam: "Beta", homeGoals: 1, awayGoals: 1 });
  return rows;
}

test("market walk-forward excludes same-day fixtures and settles only with supplied historical odds", () => {
  const result = walkForwardMarketBacktest(history(), [
    { id: "home-win", type: "1x2", selection: "home" }
  ], {
    minTrainingMatches: 10,
    minTeamAppearances: 5,
    oddsProvider: () => 2,
    stake: 10
  });
  const market = result.markets[0];
  assert.equal(result.method.includes("same-day and future fixtures excluded"), true);
  assert.equal(market.evaluated, 9);
  assert.equal(market.settledBets, 9);
  const sameDay = market.predictions.filter((row) => row.date === "2025-01-17");
  assert.equal(sameDay.length, 2);
  assert.ok(sameDay.every((row) => row.trainingMatches === 16));
  assert.ok(sameDay.every((row) => row.homeAppearances === 16 && row.awayAppearances === 16));
  assert.equal(market.summary.totalStake, 90);
  assert.equal(market.summary.bets, 9);
  assert.ok(market.predictions.every((row) => row.fairOdds > 1));
});

test("score-only historical data never invents odds or reports ROI from unpriced predictions", () => {
  const result = walkForwardMarketBacktest(history(), [
    { type: "totalGoals", selection: "over", line: 2.5 }
  ], { minTrainingMatches: 10, minTeamAppearances: 5 });
  const market = result.markets[0];
  assert.equal(market.evaluated, 9);
  assert.equal(market.missingOdds, 9);
  assert.equal(market.settledBets, 0);
  assert.equal(market.summary.totalStake, 0);
  assert.equal(market.summary.roi, null);
  assert.ok(market.predictions.every((row) => row.profit === null && row.settlement === "missing_odds"));
});

test("market walk-forward validates contracts and settings", () => {
  assert.throws(() => walkForwardMarketBacktest([], []), /at least one market/i);
  assert.throws(() => walkForwardMarketBacktest([], [{ type: "1x2", selection: "home" }], { minTrainingMatches: 0 }), /minTrainingMatches/i);
  assert.throws(() => walkForwardMarketBacktest([], [{ type: "1x2", selection: "home" }], { oddsProvider: 3 }), /oddsProvider/i);
});

test("walk-forward evaluates every supported market family from the same historical fixtures", () => {
  const descriptors = [
    { type: "1x2", selection: "home" },
    { type: "doubleChance", selection: "homeDraw" },
    { type: "totalGoals", selection: "over", line: 2.5 },
    { type: "teamTotal", team: "home", selection: "over", line: 1.5 },
    { type: "handicap", team: "away", line: 0.25 },
    { type: "btts", selection: "yes" },
    { type: "oddEven", selection: "odd" },
    { type: "correctScore", homeGoals: 2, awayGoals: 0 }
  ];
  const result = walkForwardMarketBacktest(history(), descriptors, {
    minTrainingMatches: 10, minTeamAppearances: 5
  });
  assert.equal(result.markets.length, descriptors.length);
  for (const market of result.markets) {
    assert.equal(market.evaluated, 9);
    assert.equal(market.missingOdds, 9);
    assert.equal(market.settledBets, 0);
    assert.ok(market.predictions.every((row) =>
      row.outcomes && row.fairOdds > 1 && row.settlement === "missing_odds"
    ));
  }
});
