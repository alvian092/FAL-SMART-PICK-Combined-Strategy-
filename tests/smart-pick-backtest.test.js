import test from "node:test";
import assert from "node:assert/strict";
import { walkForwardSmartPickBacktest } from "../src/smart-pick-backtest.js";

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
  rows.push({ date: "2025-01-17", league: "Test League", homeTeam: "Alpha", awayTeam: "Beta", homeGoals: 2, awayGoals: 0 });
  rows.push({ date: "2025-01-18", league: "Test League", homeTeam: "Beta", awayTeam: "Alpha", homeGoals: 0, awayGoals: 1 });
  rows.push({ date: "2025-01-19", league: "Test League", homeTeam: "Alpha", awayTeam: "Beta", homeGoals: 1, awayGoals: 1 });
  return rows;
}

const odds = () => [
  { id: "home", descriptor: { type: "1x2", selection: "home" }, odds: 5, closingOdds: 4.5 },
  { id: "draw", descriptor: { type: "1x2", selection: "draw" }, odds: 2, closingOdds: 1.9 }
];
const permissive = { minProbability: 0, minExpectedValue: -1, fractionalKelly: 0.25, maxStakeFraction: 0.02 };

test("Smart Pick walk-forward settles one best eligible candidate per fixture and computes ROI, CLV, drawdown", () => {
  const result = walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5, initialBankroll: 1000,
    pickOptions: permissive, candidateProvider: () => odds()
  });
  assert.equal(result.evaluatedBets, 3);
  assert.equal(result.summary.bets, 3);
  assert.ok(result.bets.every((bet) => bet.stake > 0 && bet.stake <= 20));
  assert.equal(result.summary.totalStake, result.bets.reduce((sum, bet) => sum + bet.stake, 0));
  assert.ok(Math.abs(result.summary.roi - result.summary.netProfit / result.summary.totalStake) < 1e-12);
  assert.equal(result.summary.clvBets, 3);
  assert.ok(result.summary.averageClv > 0);
  assert.ok(result.summary.maxDrawdown >= 0 && result.summary.maxDrawdown <= 1);
  assert.equal(result.equityCurve.length, 3);
});

test("walk-forward excludes same-day/future results from candidate decision history", () => {
  const seen = [];
  walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5, pickOptions: permissive,
    candidateProvider: (fixture, prediction) => {
      seen.push({ date: fixture.date, trainingMatches: prediction.trainingMatches });
      return odds();
    }
  });
  assert.ok(seen.every((row) => row.trainingMatches === 16 + Number(row.date >= "2025-01-18")));
  assert.deepEqual(seen.map(row => row.date), ["2025-01-17", "2025-01-18", "2025-01-19"]);
});

test("missing odds never invent ROI or CLV and produce explicit NO BET", () => {
  const result = walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5
  });
  assert.equal(result.evaluatedBets, 0);
  assert.equal(result.summary.roi, null);
  assert.equal(result.summary.averageClv, null);
  assert.equal(result.noBetFixtures.length, 3);
  assert.ok(result.noBets.every(row => row.reason === "missing_historical_odds_provider"));
});

test("candidates failing Smart Pick filters force NO BET and do not change bankroll", () => {
  const result = walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5,
    candidateProvider: () => [{ descriptor: { type: "1x2", selection: "home" }, odds: 1.01 }],
    pickOptions: { minProbability: 0.99, minExpectedValue: 0.5 }
  });
  assert.equal(result.evaluatedBets, 0);
  assert.equal(result.summary.finalBankroll, 1000);
  assert.ok(result.noBets.every(row => row.reason === "no_candidate_passed_smart_pick"));
});

test("CLV is null when closing price is absent; fixed stake cannot exceed bankroll", () => {
  const result = walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5, stake: 10,
    candidateProvider: () => [{ descriptor: { type: "1x2", selection: "home" }, odds: 5 }],
    pickOptions: permissive
  });
  assert.equal(result.summary.clvBets, 0);
  assert.equal(result.summary.averageClv, null);
  assert.equal(result.bets.length, 3);
  assert.ok(result.bets.every(row => row.clv === null));
});

test("validates bankroll, historical odds provider and risk settings", () => {
  assert.throws(() => walkForwardSmartPickBacktest([], { initialBankroll: 0 }), /initialBankroll/i);
  assert.throws(() => walkForwardSmartPickBacktest([], { candidateProvider: 3 }), /candidateProvider/i);
  assert.throws(() => walkForwardSmartPickBacktest(history(), {
    minTrainingMatches: 10, minTeamAppearances: 5, candidateProvider: () => odds(),
    pickOptions: { maxStakeFraction: 0.06 }
  }), /hard 5% bankroll cap/i);
});
