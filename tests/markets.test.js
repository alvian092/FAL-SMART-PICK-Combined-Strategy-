import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarket, evaluateAllMarkets } from "../src/markets.js";

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
