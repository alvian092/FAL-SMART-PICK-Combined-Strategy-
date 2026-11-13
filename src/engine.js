/**
 * FAL probability engine — deterministic, dependency-free baseline.
 * Inputs are expected goals (lambda), not betting recommendations.
 */

export function poissonPmf(goals, lambda) {
  if (!Number.isInteger(goals) || goals < 0) throw new RangeError("goals must be a non-negative integer");
  if (!Number.isFinite(lambda) || lambda < 0) throw new RangeError("lambda must be finite and non-negative");
  if (lambda === 0) return goals === 0 ? 1 : 0;
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return Math.exp(-lambda) * (lambda ** goals) / factorial;
}

export function scoreMatrix(lambdaHome, lambdaAway, maxGoals = 10) {
  validateLambda(lambdaHome);
  validateLambda(lambdaAway);
  if (!Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 20) {
    throw new RangeError("maxGoals must be an integer from 1 to 20");
  }
  const home = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, lambdaHome));
  const away = Array.from({ length: maxGoals + 1 }, (_, g) => poissonPmf(g, lambdaAway));
  return home.map((pHome) => away.map((pAway) => pHome * pAway));
}

export function matchProbabilities(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !matrix.every(Array.isArray)) {
    throw new TypeError("matrix must be a non-empty 2D array");
  }
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;
  let total = 0;
  matrix.forEach((row, h) => row.forEach((p, a) => {
    if (!Number.isFinite(p) || p < 0) throw new RangeError("matrix probabilities must be non-negative finite numbers");
    total += p;
    if (h > a) home += p;
    else if (h === a) draw += p;
    else away += p;
    if (h + a >= 3) over25 += p;
    if (h > 0 && a > 0) btts += p;
  }));
  if (total <= 0) throw new RangeError("matrix must have positive probability mass");
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
    over25: over25 / total,
    under25: 1 - over25 / total,
    bttsYes: btts / total,
    bttsNo: 1 - btts / total
  };
}

export function fairOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
    throw new RangeError("probability must be in (0, 1]");
  }
  return 1 / probability;
}

export function expectedValue(probability, decimalOdds) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be between 0 and 1");
  }
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new RangeError("decimal odds must be greater than 1");
  }
  return probability * decimalOdds - 1;
}

export function noVigProbabilities(decimalOdds) {
  if (!Array.isArray(decimalOdds) || decimalOdds.length < 2 ||
      decimalOdds.some((odd) => !Number.isFinite(odd) || odd <= 1)) {
    throw new RangeError("provide at least two valid decimal odds greater than 1");
  }
  const implied = decimalOdds.map((odd) => 1 / odd);
  const overround = implied.reduce((sum, p) => sum + p, 0);
  return implied.map((p) => p / overround);
}

function validateLambda(value) {
  if (!Number.isFinite(value) || value < 0 || value > 8) {
    throw new RangeError("lambda must be between 0 and 8");
  }
}
