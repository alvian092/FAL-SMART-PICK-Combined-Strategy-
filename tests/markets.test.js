import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarket, evaluateAllMarkets, settleMarketBet, summarizeMarketBets } from "../src/markets.js";

const close = (a, b, tolerance = 1e-10) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not close to ${b}`);

function singleScore(homeGoals, awayGoals) {
  const matrix = Array.from({ length: homeGoals + 1 }, () => Array(awayGoals + 1).fill(0));
  matrix[homeGoals][awayGoals] = 1;
  return matrix;
}

test("1X2 and double-chance markets settle each result correctly", () => {
  const matrix = singleScore(2, 1);
  assert.equal(evaluateMarket(matrix, { type: "1x2", selection: "home" }).outcomes.win, 1);
  assert.equal(evaluateMarket(matrix, { type: "1x2", selection: "draw" }).outcomes.loss, 1);
  assert.equal(evaluateMarket(matrix, { type: "doubleChance", selection: "homeDraw" }).outcomes.win, 1);
  assert.equal(evaluateMarket(matrix, { type: "doubleChance", selection: "drawAway" }).outcomes.loss, 1);
});

test("Asian totals settle whole, half, quarter, push, half-win and half-loss lines", () => {
  const twoGoals = singleScore(1, 1);
  assert.equal(evaluateMarket(twoGoals, { type: "totalGoals", selection: "over", line: 2 }).outcomes.push, 1);
  assert.equal(evaluateMarket(twoGoals, { type: "totalGoals", selection: "under", line: 2 }).outcomes.push, 1);
  assert.equal(evaluateMarket(twoGoals, { type: "totalGoals", selection: "over", line: 2.25 }).outcomes.halfLoss, 1);
  assert.equal(evaluateMarket(twoGoals, { type: "totalGoals", selection: "under", line: 2.25 }).outcomes.halfWin, 1);
  assert.equal(evaluateMarket(singleScore(2, 1), { type: "totalGoals", selection: "over", line: 2.75 }).outcomes.halfWin, 1);
  assert.equal(evaluateMarket(singleScore(2, 1), { type: "totalGoals", selection: "under", line: 2.75 }).outcomes.halfLoss, 1);
});

test("handicap and team-total quarter lines use selected-team perspective", () => {
  const draw = singleScore(1, 1);
  assert.equal(evaluateMarket(draw, { type: "handicap", team: "home", line: -0.25 }).outcomes.halfLoss, 1);
  assert.equal(evaluateMarket(draw, { type: "handicap", team: "home", line: 0.25 }).outcomes.halfWin, 1);
  assert.equal(evaluateMarket(singleScore(0, 2), { type: "teamTotal", team: "away", selection: "over", line: 1.75 }).outcomes.halfWin, 1);
  assert.equal(evaluateMarket(singleScore(1, 0), { type: "teamTotal", team: "home", selection: "under", line: 0.75 }).outcomes.halfLoss, 1);
});

test("odd-even and correct-score markets settle exact score outcomes", () => {
  const matrix = singleScore(2, 1);
  assert.equal(evaluateMarket(matrix, { type: "btts", selection: "yes" }).outcomes.win, 1);
  assert.equal(evaluateMarket(matrix, { type: "btts", selection: "no" }).outcomes.loss, 1);
  assert.equal(evaluateMarket(matrix, { type: "oddEven", selection: "odd" }).outcomes.win, 1);
  assert.equal(evaluateMarket(matrix, { type: "oddEven", selection: "even" }).outcomes.loss, 1);
  assert.equal(evaluateMarket(matrix, { type: "correctScore", homeGoals: 2, awayGoals: 1 }).outcomes.win, 1);
  assert.equal(evaluateMarket(matrix, { type: "correctScore", homeGoals: 1, awayGoals: 2 }).outcomes.loss, 1);
});

test("fair odds, expected value and Kelly use full settlement distribution", () => {
  const matrix = [[0.5, 0.5]];
  const result = evaluateMarket(matrix, { type: "1x2", selection: "draw" }, 3.5);
  close(result.outcomes.win, 0.5);
  close(result.outcomes.loss, 0.5);
  close(result.fairOdds, 2);
  close(result.expectedValue, 0.75);
  assert.ok(result.kellyFraction > 0 && result.kellyFraction < 1);
  const noValue = evaluateMarket(matrix, { type: "1x2", selection: "draw" }, 1.5);
  assert.equal(noValue.kellyFraction, 0);
  assert.equal(noValue.expectedValue, -0.25);
  assert.throws(() => evaluateMarket(matrix, { type: "totalGoals", selection: "over", line: 2.3 }), /0.25 increments/i);
  assert.throws(() => evaluateMarket(matrix, { type: "1x2", selection: "home" }, 1), /greater than 1/i);
});

test("all-markets builder returns the supported market families with normalized outcomes", () => {
  const markets = evaluateAllMarkets([[0.25, 0.25], [0.25, 0.25]], {
    totalsLines: [2.25], handicapLines: [-0.25, 0.25], teamTotalLines: [0.75]
  });
  const types = new Set(markets.map((market) => market.type));
  for (const type of ["1x2", "doubleChance", "totalGoals", "teamTotal", "handicap", "btts", "oddEven", "correctScore"]) {
    assert.ok(types.has(type), `missing ${type}`);
  }
  assert.ok(markets.some((market) => market.type === "correctScore" && market.homeGoals === 0 && market.awayGoals === 0));
  assert.ok(markets.find((market) => market.type === "1x2").fairOdds > 1);
  for (const market of markets) {
    const total = Object.values(market.outcomes).reduce((sum, value) => sum + value, 0);
    close(total, 1);
  }
});

test("actual bet settlement calculates win, half-win, push, half-loss and loss P/L", () => {
  const win = settleMarketBet({ type: "1x2", selection: "home" }, 2, 0, 2, 100);
  assert.equal(win.outcome, "win");
  assert.equal(win.profit, 100);
  assert.equal(win.returnAmount, 200);

  const halfWin = settleMarketBet({ type: "totalGoals", selection: "under", line: 2.25 }, 1, 1, 2, 100);
  assert.equal(halfWin.outcome, "halfWin");
  assert.equal(halfWin.profit, 50);

  const push = settleMarketBet({ type: "totalGoals", selection: "over", line: 2 }, 1, 1, 1.9, 50);
  assert.equal(push.outcome, "push");
  assert.equal(push.profit, 0);
  assert.equal(push.returnAmount, 50);

  const halfLoss = settleMarketBet({ type: "handicap", team: "home", line: -0.25 }, 1, 1, 2, 80);
  assert.equal(halfLoss.outcome, "halfLoss");
  assert.equal(halfLoss.profit, -40);

  const loss = settleMarketBet({ type: "1x2", selection: "home" }, 0, 1, 2.1, 100);
  assert.equal(loss.outcome, "loss");
  assert.equal(loss.profit, -100);

  const splitWin = settleMarketBet({ type: "handicap", team: "home", line: 0.25 }, 1, 1, 2, 100);
  assert.equal(splitWin.outcome, "halfWin");
  assert.equal(splitWin.profit, 50);
});

test("market bet summary calculates turnover, net P/L and ROI", () => {
  const bets = [
    settleMarketBet({ type: "1x2", selection: "home" }, 2, 0, 2, 100),
    settleMarketBet({ type: "totalGoals", selection: "under", line: 2.25 }, 1, 1, 2.5, 100),
    settleMarketBet({ type: "totalGoals", selection: "over", line: 2 }, 1, 1, 1.9, 50),
    settleMarketBet({ type: "handicap", team: "home", line: -0.25 }, 1, 1, 2, 80),
    settleMarketBet({ type: "1x2", selection: "home" }, 0, 1, 2.1, 100),
    settleMarketBet({ type: "1x2", selection: "home" }, 2, 0, 3, 60)
  ];
  const summary = summarizeMarketBets(bets);
  assert.equal(summary.bets, 6);
  assert.equal(summary.totalStake, 490);
  assert.equal(summary.netProfit, 155);
  close(summary.roi, 155 / 490);
  assert.equal(summary.wins, 2);
  assert.equal(summary.halfWins, 1);
  assert.equal(summary.pushes, 1);
  assert.equal(summary.halfLosses, 1);
  assert.equal(summary.losses, 1);
  assert.throws(() => summarizeMarketBets([{ stake: 10, profit: 1, outcome: "unknown" }]), /unknown/i);
});


test("all 1X2 selections are validated instead of silently pricing invalid selections as losses", () => {
  const matrix = [[0.2, 0.3], [0.1, 0.4]];
  for (const selection of ["home", "draw", "away"]) {
    const result = evaluateMarket(matrix, { type: "1x2", selection });
    close(Object.values(result.outcomes).reduce((sum, value) => sum + value, 0), 1);
  }
  for (const selection of ["1", "Home", "none", "", null, undefined]) {
    assert.throws(() => evaluateMarket(matrix, { type: "1x2", selection }), /home, draw, or away/i);
    assert.throws(() => settleMarketBet({ type: "1x2", selection }, 1, 0, 2), /home, draw, or away/i);
  }
});

test("double chance, BTTS, odd-even and correct-score selections reject invalid descriptors", () => {
  const matrix = [[0.25, 0.25], [0.25, 0.25]];
  assert.throws(() => evaluateMarket(matrix, { type: "doubleChance", selection: "home" }), /homeDraw/i);
  assert.throws(() => evaluateMarket(matrix, { type: "btts", selection: "maybe" }), /yes or no/i);
  assert.throws(() => evaluateMarket(matrix, { type: "oddEven", selection: "both" }), /odd or even/i);
  assert.throws(() => evaluateMarket(matrix, { type: "correctScore", homeGoals: -1, awayGoals: 0 }), /non-negative integer/i);
  assert.throws(() => evaluateMarket(matrix, { type: "correctScore", homeGoals: 0.5, awayGoals: 0 }), /non-negative integer/i);
});

test("settlement truth table covers every score-based market family", () => {
  const score = (h, a) => singleScore(h, a);
  const cases = [
    [{ type: "1x2", selection: "home" }, 2, 1, "win"],
    [{ type: "1x2", selection: "draw" }, 2, 1, "loss"],
    [{ type: "1x2", selection: "away" }, 1, 2, "win"],
    [{ type: "doubleChance", selection: "homeDraw" }, 1, 1, "win"],
    [{ type: "doubleChance", selection: "homeAway" }, 0, 2, "win"],
    [{ type: "doubleChance", selection: "drawAway" }, 2, 0, "loss"],
    [{ type: "totalGoals", selection: "over", line: 2.25 }, 1, 1, "halfLoss"],
    [{ type: "totalGoals", selection: "under", line: 2.25 }, 1, 1, "halfWin"],
    [{ type: "totalGoals", selection: "over", line: 2.75 }, 2, 1, "halfWin"],
    [{ type: "totalGoals", selection: "under", line: 2.75 }, 2, 1, "halfLoss"],
    [{ type: "teamTotal", team: "home", selection: "over", line: 1.5 }, 2, 0, "win"],
    [{ type: "teamTotal", team: "away", selection: "under", line: 1.5 }, 2, 1, "win"],
    [{ type: "handicap", team: "home", line: -0.25 }, 1, 1, "halfLoss"],
    [{ type: "handicap", team: "home", line: 0.25 }, 1, 1, "halfWin"],
    [{ type: "btts", selection: "yes" }, 1, 1, "win"],
    [{ type: "btts", selection: "no" }, 0, 1, "win"],
    [{ type: "oddEven", selection: "odd" }, 2, 1, "win"],
    [{ type: "oddEven", selection: "even" }, 2, 0, "win"],
    [{ type: "correctScore", homeGoals: 2, awayGoals: 1 }, 2, 1, "win"]
  ];
  for (const [descriptor, home, away, expected] of cases) {
    const result = evaluateMarket(score(home, away), descriptor);
    assert.equal(Object.entries(result.outcomes).find(([, p]) => p === 1)?.[0], expected,
      JSON.stringify(descriptor));
    const settled = settleMarketBet(descriptor, home, away, 2, 20);
    assert.equal(settled.outcome, expected, JSON.stringify(descriptor));
  }
});

test("market evaluation validates matrices, Asian line bounds and option ranges", () => {
  assert.throws(() => evaluateMarket([], { type: "1x2", selection: "home" }), /non-empty rectangular/i);
  assert.throws(() => evaluateMarket([[0.5], [0.2, 0.3]], { type: "1x2", selection: "home" }), /rectangular/i);
  assert.throws(() => evaluateMarket([[0, 0]], { type: "1x2", selection: "home" }), /positive probability mass/i);
  assert.throws(() => evaluateMarket([[1]], { type: "totalGoals", selection: "over", line: 20.25 }), /between -20 and 20/i);
  assert.throws(() => evaluateAllMarkets([[1]], { correctScoreMaxGoals: 21 }), /0 to 20/i);
});

test("settlement rejects invalid actual scores, odds, stakes and unknown markets", () => {
  const pick = { type: "1x2", selection: "home" };
  assert.throws(() => settleMarketBet(pick, -1, 0, 2), /actual goals/i);
  assert.throws(() => settleMarketBet(pick, 0.5, 0, 2), /actual goals/i);
  assert.throws(() => settleMarketBet(pick, 0, 0, 1), /greater than 1/i);
  assert.throws(() => settleMarketBet(pick, 0, 0, 2, 0), /stake/i);
  assert.throws(() => settleMarketBet({ type: "unknown" }, 0, 0, 2), /unsupported market/i);
});

test("Asian settlement profit and return amount are correct for partial outcomes", () => {
  const halfWin = settleMarketBet({ type: "totalGoals", selection: "under", line: 2.25 }, 1, 1, 2.4, 100);
  assert.equal(halfWin.profit, 70);
  assert.equal(halfWin.returnAmount, 170);
  const halfLoss = settleMarketBet({ type: "handicap", team: "home", line: -0.25 }, 1, 1, 2.4, 100);
  assert.equal(halfLoss.profit, -50);
  assert.equal(halfLoss.returnAmount, 50);
  const quarterHalfLoss = settleMarketBet({ type: "totalGoals", selection: "over", line: 2.25 }, 2, 0, 2.4, 100);
  assert.equal(quarterHalfLoss.outcome, "halfLoss");
  assert.equal(quarterHalfLoss.profit, -50);
});


test("market probabilities are invariant to positive matrix scaling", () => {
  const matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  const scaled = matrix.map((row) => row.map((value) => value * 37));
  const descriptor = { type: "totalGoals", selection: "over", line: 2.25 };
  const first = evaluateMarket(matrix, descriptor);
  const second = evaluateMarket(scaled, descriptor);
  for (const key of Object.keys(first.outcomes)) close(first.outcomes[key], second.outcomes[key]);
  close(first.fairOdds, second.fairOdds);
});

test("quarter-line fair odds break even against the full settlement distribution", () => {
  const matrix = [
    [0.04, 0.06, 0.08, 0.05],
    [0.07, 0.10, 0.12, 0.08],
    [0.06, 0.11, 0.09, 0.05],
    [0.03, 0.04, 0.02, 0.00]
  ];
  const descriptors = [
    { type: "totalGoals", selection: "over", line: 2.25 },
    { type: "totalGoals", selection: "under", line: 2.75 },
    { type: "handicap", team: "home", line: -0.25 },
    { type: "handicap", team: "away", line: 0.75 },
    { type: "teamTotal", team: "home", selection: "over", line: 1.25 },
    { type: "teamTotal", team: "away", selection: "under", line: 1.75 }
  ];
  for (const descriptor of descriptors) {
    const priced = evaluateMarket(matrix, descriptor);
    assert.ok(priced.fairOdds > 1, JSON.stringify(descriptor));
    const atFair = evaluateMarket(matrix, descriptor, priced.fairOdds);
    close(atFair.expectedValue, 0, 1e-9);
  }
});

test("empty settlement summary reports undefined ROI rather than zero ROI", () => {
  const summary = summarizeMarketBets([]);
  assert.equal(summary.bets, 0);
  assert.equal(summary.totalStake, 0);
  assert.equal(summary.netProfit, 0);
  assert.equal(summary.roi, null);
  assert.equal(summary.averageProfitPerBet, null);
});

test("settlement return amount reconciles to stake plus net profit for every outcome", () => {
  const cases = [
    [{ type: "1x2", selection: "home" }, 2, 0, 2.1],
    [{ type: "totalGoals", selection: "under", line: 2.25 }, 1, 1, 2.4],
    [{ type: "totalGoals", selection: "over", line: 2 }, 1, 1, 1.9],
    [{ type: "handicap", team: "home", line: -0.25 }, 1, 1, 2.2],
    [{ type: "1x2", selection: "away" }, 2, 0, 3.1]
  ];
  for (const [descriptor, home, away, odds] of cases) {
    const settled = settleMarketBet(descriptor, home, away, odds, 73);
    close(settled.returnAmount, settled.stake + settled.profit);
    assert.ok(settled.returnAmount >= 0);
  }
});
