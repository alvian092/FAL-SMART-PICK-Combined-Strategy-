/**
 * FAL market settlement engine.
 * Matrix rows are home goals and columns are away goals. Every market is
 * settled from the same score distribution; quarter lines split into two
 * adjacent half-stakes so push/half-win/half-loss are represented explicitly.
 */

const OUTCOME_KEYS = ["win", "halfWin", "push", "halfLoss", "loss", "split"];

function validateMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !matrix.every((row) => Array.isArray(row) && row.length === matrix[0].length)) {
    throw new TypeError("matrix must be a non-empty rectangular score matrix");
  }
  let total = 0;
  matrix.forEach((row) => row.forEach((value) => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("matrix values must be finite non-negative probabilities");
    total += value;
  }));
  if (total <= 0) throw new RangeError("matrix must have positive probability mass");
  return total;
}

function splitAsianLine(line) {
  if (!Number.isFinite(line) || Math.abs(line) > 20) throw new RangeError("line must be finite and between -20 and 20");
  const quarterUnits = Math.round(line * 4);
  if (Math.abs(line * 4 - quarterUnits) > 1e-8) throw new RangeError("Asian line must use 0.25 increments");
  if (Math.abs(quarterUnits % 2) === 1) return [line - 0.25, line + 0.25];
  return [line];
}

function settleDifference(difference) {
  if (Math.abs(difference) < 1e-9) return "push";
  return difference > 0 ? "win" : "loss";
}

function combineParts(parts) {
  if (parts.length === 1) return parts[0];
  const key = parts.slice().sort().join("+");
  const combinations = {
    "loss+loss": "loss",
    "loss+push": "halfLoss",
    "push+push": "push",
    "push+win": "halfWin",
    "win+win": "win",
    "loss+win": "split"
  };
  if (!combinations[key]) throw new Error("unsupported Asian line settlement combination");
  return combinations[key];
}

function marketOutcome(type, selection, homeGoals, awayGoals, descriptor) {
  if (type === "1x2") {
    const actual = homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";
    return actual === selection ? "win" : "loss";
  }
  if (type === "doubleChance") {
    const actual = homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";
    const accepted = { homeDraw: ["home", "draw"], homeAway: ["home", "away"], drawAway: ["draw", "away"] };
    if (!accepted[selection]) throw new RangeError("doubleChance selection must be homeDraw, homeAway, or drawAway");
    return accepted[selection].includes(actual) ? "win" : "loss";
  }
  if (type === "totalGoals" || type === "teamTotal" || type === "handicap") {
    const lines = splitAsianLine(descriptor.line);
    const parts = lines.map((line) => {
      let difference;
      if (type === "totalGoals") {
        if (!["over", "under"].includes(selection)) throw new RangeError("totalGoals selection must be over or under");
        const total = homeGoals + awayGoals;
        difference = selection === "over" ? total - line : line - total;
      } else if (type === "teamTotal") {
        const team = descriptor.team;
        if (!["home", "away"].includes(team) || !["over", "under"].includes(selection)) {
          throw new RangeError("teamTotal requires team home/away and selection over/under");
        }
        const goals = team === "home" ? homeGoals : awayGoals;
        difference = selection === "over" ? goals - line : line - goals;
      } else {
        const team = descriptor.team;
        if (!["home", "away"].includes(team)) throw new RangeError("handicap requires team home or away");
        const selectedGoals = team === "home" ? homeGoals : awayGoals;
        const opponentGoals = team === "home" ? awayGoals : homeGoals;
        difference = selectedGoals + line - opponentGoals;
      }
      return settleDifference(difference);
    });
    return combineParts(parts);
  }
  if (type === "oddEven") {
    if (!["odd", "even"].includes(selection)) throw new RangeError("oddEven selection must be odd or even");
    return (homeGoals + awayGoals) % 2 === (selection === "odd" ? 1 : 0) ? "win" : "loss";
  }
  if (type === "correctScore") {
    if (!Number.isInteger(descriptor.homeGoals) || descriptor.homeGoals < 0 ||
        !Number.isInteger(descriptor.awayGoals) || descriptor.awayGoals < 0) {
      throw new RangeError("correctScore requires non-negative integer homeGoals and awayGoals");
    }
    return homeGoals === descriptor.homeGoals && awayGoals === descriptor.awayGoals ? "win" : "loss";
  }
  throw new RangeError("unsupported market type");
}

function priceOutcomes(outcomes, decimalOdds) {
  const p = outcomes;
  const winExposure = p.win + 0.5 * p.halfWin + 0.5 * p.split;
  const lossExposure = p.loss + 0.5 * p.halfLoss + 0.5 * p.split;
  const fairOdds = winExposure > 0 ? 1 + lossExposure / winExposure : null;
  if (decimalOdds === undefined || decimalOdds === null || decimalOdds === "") {
    return { fairOdds, expectedValue: null, kellyFraction: null };
  }
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new RangeError("decimal odds must be greater than 1");
  const returns = {
    win: decimalOdds - 1,
    halfWin: (decimalOdds - 1) / 2,
    push: 0,
    halfLoss: -0.5,
    loss: -1,
    split: (decimalOdds - 2) / 2
  };
  const expectedValue = OUTCOME_KEYS.reduce((sum, key) => sum + p[key] * returns[key], 0);
  const derivative = (fraction) => OUTCOME_KEYS.reduce((sum, key) => {
    const denominator = 1 + fraction * returns[key];
    return denominator <= 0 ? -Infinity : sum + p[key] * returns[key] / denominator;
  }, 0);
  let kellyFraction = 0;
  if (expectedValue > 0) {
    const worst = Math.min(...OUTCOME_KEYS.filter((key) => p[key] > 0).map((key) => returns[key]));
    if (worst >= 0) kellyFraction = 1;
    else {
      let low = 0;
      let high = 0.999999 / -worst;
      if (derivative(high) > 0) kellyFraction = high;
      else {
        for (let i = 0; i < 80; i += 1) {
          const mid = (low + high) / 2;
          if (derivative(mid) > 0) low = mid;
          else high = mid;
        }
        kellyFraction = (low + high) / 2;
      }
    }
  }
  return { fairOdds, expectedValue, kellyFraction };
}

/**
 * Evaluate one selected market.
 * Examples:
 * {type:"totalGoals", selection:"over", line:2.25}
 * {type:"handicap", team:"home", line:-0.5}
 * {type:"teamTotal", team:"away", selection:"under", line:1.5}
 */
export function evaluateMarket(matrix, descriptor, decimalOdds) {
  const total = validateMatrix(matrix);
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("market descriptor is required");
  const outcomes = Object.fromEntries(OUTCOME_KEYS.map((key) => [key, 0]));
  matrix.forEach((row, homeGoals) => row.forEach((probability, awayGoals) => {
    const outcome = marketOutcome(descriptor.type, descriptor.selection, homeGoals, awayGoals, descriptor);
    outcomes[outcome] += probability / total;
  }));
  const pricing = priceOutcomes(outcomes, decimalOdds);
  return { type: descriptor.type, selection: descriptor.selection ?? null, team: descriptor.team ?? null,
    line: descriptor.line ?? null, homeGoals: descriptor.homeGoals ?? null, awayGoals: descriptor.awayGoals ?? null,
    outcomes, fairOdds: pricing.fairOdds,
    expectedValue: pricing.expectedValue, kellyFraction: pricing.kellyFraction };
}

export function evaluateAllMarkets(matrix, options = {}) {
  const totalsLines = options.totalsLines ?? [1.5, 2, 2.25, 2.5, 2.75, 3, 3.5];
  const handicapLines = options.handicapLines ?? [-1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5];
  const teamTotalLines = options.teamTotalLines ?? [0.5, 1, 1.5, 2, 2.5];
  const markets = [];
  for (const selection of ["home", "draw", "away"]) markets.push(evaluateMarket(matrix, { type: "1x2", selection }));
  for (const selection of ["homeDraw", "homeAway", "drawAway"]) markets.push(evaluateMarket(matrix, { type: "doubleChance", selection }));
  for (const line of totalsLines) for (const selection of ["over", "under"]) markets.push(evaluateMarket(matrix, { type: "totalGoals", selection, line }));
  for (const team of ["home", "away"]) {
    for (const line of teamTotalLines) for (const selection of ["over", "under"]) {
      markets.push(evaluateMarket(matrix, { type: "teamTotal", team, selection, line }));
    }
    for (const line of handicapLines) markets.push(evaluateMarket(matrix, { type: "handicap", team, line }));
  }
  for (const selection of ["odd", "even"]) markets.push(evaluateMarket(matrix, { type: "oddEven", selection }));
  const correctScoreMaxGoals = options.correctScoreMaxGoals ?? Math.min(5, matrix.length - 1, matrix[0].length - 1);
  if (!Number.isInteger(correctScoreMaxGoals) || correctScoreMaxGoals < 0 || correctScoreMaxGoals > 20) {
    throw new RangeError("correctScoreMaxGoals must be an integer from 0 to 20");
  }
  for (let homeGoals = 0; homeGoals <= Math.min(correctScoreMaxGoals, matrix.length - 1); homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= Math.min(correctScoreMaxGoals, matrix[0].length - 1); awayGoals += 1) {
      markets.push(evaluateMarket(matrix, { type: "correctScore", homeGoals, awayGoals }));
    }
  }
  return markets;
}
