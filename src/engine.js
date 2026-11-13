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


const DEFAULT_HOME_GOALS = 1.35;
const DEFAULT_AWAY_GOALS = 1.10;

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Estimate pre-match expected goals from each team's latest appearances.
 * Uses all imported competitions, venue-adjusted league-wide baselines,
 * exponential recency weights, and a small prior to reduce noisy samples.
 * A match on/after cutoffDate is excluded to prevent look-ahead leakage.
 */
export function estimateLambdas(matches, homeTeam, awayTeam, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  if (typeof homeTeam !== "string" || !homeTeam.trim() ||
      typeof awayTeam !== "string" || !awayTeam.trim() || homeTeam === awayTeam) {
    throw new TypeError("choose two different valid team names");
  }
  const limit = options.limit ?? 20;
  const recencyDecay = options.recencyDecay ?? 0.95;
  const priorMatches = options.priorMatches ?? 5;
  const cutoffDate = options.cutoffDate ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("limit must be an integer from 1 to 100");
  }
  if (!Number.isFinite(recencyDecay) || recencyDecay <= 0 || recencyDecay > 1) {
    throw new RangeError("recencyDecay must be in (0, 1]");
  }
  if (!Number.isFinite(priorMatches) || priorMatches < 0 || priorMatches > 100) {
    throw new RangeError("priorMatches must be between 0 and 100");
  }
  if (cutoffDate && !validIsoDate(cutoffDate)) {
    throw new TypeError("cutoffDate must use YYYY-MM-DD");
  }

  const eligible = matches.map((match, index) => ({ match, index }))
    .filter(({ match }) => match && validIsoDate(match.date) &&
      Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
      Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
      typeof match.homeTeam === "string" && typeof match.awayTeam === "string" &&
      (!cutoffDate || match.date < cutoffDate));

  if (!eligible.length) throw new RangeError("no valid historical matches before the analysis date");

  const homeGoalAverage = eligible.reduce((sum, item) => sum + item.match.homeGoals, 0) / eligible.length;
  const awayGoalAverage = eligible.reduce((sum, item) => sum + item.match.awayGoals, 0) / eligible.length;
  const usedFallbackBaseline = homeGoalAverage === 0 || awayGoalAverage === 0;
  const baselineHome = homeGoalAverage > 0 ? homeGoalAverage : DEFAULT_HOME_GOALS;
  const baselineAway = awayGoalAverage > 0 ? awayGoalAverage : DEFAULT_AWAY_GOALS;

  function teamSample(team) {
    return eligible
      .filter(({ match }) => match.homeTeam === team || match.awayTeam === team)
      .sort((a, b) => b.match.date.localeCompare(a.match.date) || b.index - a.index)
      .slice(0, limit);
  }

  function strengths(sample) {
    if (!sample.length) throw new RangeError("insufficient history: one or both teams have no eligible matches");
    let weightTotal = 0;
    let scored = 0;
    let conceded = 0;
    let expectedScored = 0;
    let expectedConceded = 0;
    sample.forEach(({ match }, index) => {
      const weight = recencyDecay ** index;
      // The sample carries its team name below; venue baselines follow the team's role.
      const teamIsHome = match.homeTeam === sample.teamName;
      const teamScored = teamIsHome ? match.homeGoals : match.awayGoals;
      const teamConceded = teamIsHome ? match.awayGoals : match.homeGoals;
      const scoringBaseline = teamIsHome ? baselineHome : baselineAway;
      const concedingBaseline = teamIsHome ? baselineAway : baselineHome;
      weightTotal += weight;
      scored += teamScored * weight;
      conceded += teamConceded * weight;
      expectedScored += scoringBaseline * weight;
      expectedConceded += concedingBaseline * weight;
    });
    const priorScored = priorMatches * (expectedScored / weightTotal);
    const priorConceded = priorMatches * (expectedConceded / weightTotal);
    return {
      appearances: sample.length,
      oldestDate: sample[sample.length - 1].match.date,
      newestDate: sample[0].match.date,
      attack: (scored + priorScored) / (expectedScored + priorScored),
      defensiveWeakness: (conceded + priorConceded) / (expectedConceded + priorConceded)
    };
  }

  const homeSample = teamSample(homeTeam);
  const awaySample = teamSample(awayTeam);
  homeSample.teamName = homeTeam;
  awaySample.teamName = awayTeam;
  const home = strengths(homeSample);
  const away = strengths(awaySample);
  const rawHomeLambda = baselineHome * home.attack * away.defensiveWeakness;
  const rawAwayLambda = baselineAway * away.attack * home.defensiveWeakness;
  const lambdaHome = Math.min(8, Math.max(0, rawHomeLambda));
  const lambdaAway = Math.min(8, Math.max(0, rawAwayLambda));

  return {
    lambdaHome,
    lambdaAway,
    home,
    away,
    baselineHome,
    baselineAway,
    usedFallbackBaseline,
    cutoffDate: cutoffDate || null,
    limit,
    recencyDecay,
    priorMatches,
    clamped: lambdaHome !== rawHomeLambda || lambdaAway !== rawAwayLambda
  };
}



/** Deterministic fixture-bootstrap sensitivity intervals, using only matches before cutoffDate. */
export function estimateProbabilityIntervals(matches, homeTeam, awayTeam, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  if (typeof homeTeam !== "string" || !homeTeam.trim() || typeof awayTeam !== "string" || !awayTeam.trim() || homeTeam === awayTeam) throw new TypeError("choose two different valid team names");
  const cutoffDate = options.cutoffDate ?? "";
  const iterations = options.iterations ?? 200;
  const confidenceLevel = options.confidenceLevel ?? 0.9;
  const rho = options.rho ?? -0.08;
  const maxGoals = options.maxGoals ?? 12;
  if (cutoffDate && !validIsoDate(cutoffDate)) throw new TypeError("cutoffDate must use YYYY-MM-DD");
  if (!Number.isInteger(iterations) || iterations < 50 || iterations > 1000) throw new RangeError("iterations must be an integer from 50 to 1000");
  if (!Number.isFinite(confidenceLevel) || confidenceLevel <= 0.5 || confidenceLevel >= 1) throw new RangeError("confidenceLevel must be between 0.5 and 1");
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) throw new RangeError("rho must be between -1 and 1");
  if (!Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 20) throw new RangeError("maxGoals must be from 1 to 20");
  const eligible = matches.filter((m) => m && validIsoDate(m.date) && Number.isInteger(m.homeGoals) && m.homeGoals >= 0 && Number.isInteger(m.awayGoals) && m.awayGoals >= 0 && typeof m.homeTeam === "string" && typeof m.awayTeam === "string" && (!cutoffDate || m.date < cutoffDate));
  if (eligible.length < 10) throw new RangeError("at least 10 historical fixtures before the analysis date are required");
  for (const team of [homeTeam, awayTeam]) if (eligible.filter((m) => m.homeTeam === team || m.awayTeam === team).length < 5) throw new RangeError("at least 5 prior appearances per team are required for bootstrap intervals");
  let seed = options.seed;
  if (seed === undefined) seed = [...`${homeTeam}|${awayTeam}|${cutoffDate}`].reduce((v, ch) => Math.imul(v ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be an unsigned 32-bit integer");
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const samples = { home: [], draw: [], away: [], over25: [], bttsYes: [], lambdaHome: [], lambdaAway: [] };
  const predictiveSamples = { homeGoals: [], awayGoals: [], totalGoals: [], goalDifference: [] };
  let failedIterations = 0;
  for (let i = 0; i < iterations; i += 1) {
    const bootstrap = Array.from({ length: eligible.length }, () => eligible[Math.floor(random() * eligible.length)]);
    try {
      const lambda = estimateLambdas(bootstrap, homeTeam, awayTeam, { limit: 20, recencyDecay: 0.95, priorMatches: 5 });
      const matrix = dixonColesScoreMatrix(lambda.lambdaHome, lambda.lambdaAway, rho, maxGoals);
      const probabilities = matchProbabilities(matrix);
      for (const key of ["home", "draw", "away", "over25", "bttsYes"]) samples[key].push(probabilities[key]);
      samples.lambdaHome.push(lambda.lambdaHome); samples.lambdaAway.push(lambda.lambdaAway);

      // Posterior-predictive draw: propagate both historical-sample and match-outcome uncertainty.
      const target = random();
      let cumulative = 0;
      let selectedHome = maxGoals;
      let selectedAway = maxGoals;
      let selected = false;
      for (let h = 0; h < matrix.length && !selected; h += 1) {
        for (let a = 0; a < matrix[h].length; a += 1) {
          cumulative += matrix[h][a];
          if (target <= cumulative) {
            selectedHome = h;
            selectedAway = a;
            selected = true;
            break;
          }
        }
      }
      predictiveSamples.homeGoals.push(selectedHome);
      predictiveSamples.awayGoals.push(selectedAway);
      predictiveSamples.totalGoals.push(selectedHome + selectedAway);
      predictiveSamples.goalDifference.push(selectedHome - selectedAway);
    } catch { failedIterations += 1; }
  }
  const successfulIterations = samples.home.length;
  if (successfulIterations < Math.max(30, Math.ceil(iterations * 0.7))) throw new RangeError("too few valid bootstrap samples; import more history for both teams");
  const alpha = (1 - confidenceLevel) / 2;
  const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), fraction = pos - lo;
    return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * fraction;
  };
  const intervals = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, { lower: quantile(values, alpha), upper: quantile(values, 1 - alpha), median: quantile(values, 0.5) }]));
  const predictiveIntervals = Object.fromEntries(Object.entries(predictiveSamples).map(([key, values]) => [key, {
    lower: quantile(values, alpha), upper: quantile(values, 1 - alpha), median: quantile(values, 0.5)
  }]));
  return {
    confidenceLevel, iterations, successfulIterations, failedIterations, sampleSize: eligible.length,
    cutoffDate: cutoffDate || null, method: "fixture bootstrap with replacement",
    intervals, predictiveIntervals
  };
}

/**
 * Apply the Dixon-Coles low-score correction to an independent Poisson matrix.
 * rho=0 is the independent-Poisson baseline. Corrected truncated matrices are
 * normalized so market probabilities sum to one.
 */
export function dixonColesScoreMatrix(lambdaHome, lambdaAway, rho = -0.08, maxGoals = 10) {
  validateLambda(lambdaHome);
  validateLambda(lambdaAway);
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
    throw new RangeError("rho must be finite and between -1 and 1");
  }
  if (!Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 20) {
    throw new RangeError("maxGoals must be an integer from 1 to 20");
  }

  const matrix = scoreMatrix(lambdaHome, lambdaAway, maxGoals);
  const corrections = [
    [1 - lambdaHome * lambdaAway * rho, 1 + lambdaHome * rho],
    [1 + lambdaAway * rho, 1 - rho]
  ];
  corrections.forEach((row) => row.forEach((factor) => {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new RangeError("rho produces a non-positive Dixon-Coles correction factor");
    }
  }));

  matrix[0][0] *= corrections[0][0];
  if (maxGoals >= 1) {
    matrix[0][1] *= corrections[0][1];
    matrix[1][0] *= corrections[1][0];
    matrix[1][1] *= corrections[1][1];
  }
  const total = matrix.flat().reduce((sum, probability) => sum + probability, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("Dixon-Coles matrix has no positive probability mass");
  }
  return matrix.map((row) => row.map((probability) => probability / total));
}

/**
 * Calculate basic chronological Elo ratings from historical results.
 * Home advantage affects expected scores, while rating updates remain
 * zero-sum. Only fixtures strictly before cutoffDate are included.
 */
export function estimateElo(matches, homeTeam, awayTeam, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  if (typeof homeTeam !== "string" || !homeTeam.trim() ||
      typeof awayTeam !== "string" || !awayTeam.trim() || homeTeam === awayTeam) {
    throw new TypeError("choose two different valid team names");
  }
  const initialRating = options.initialRating ?? 1500;
  const kFactor = options.kFactor ?? 20;
  const homeAdvantage = options.homeAdvantage ?? 60;
  const cutoffDate = options.cutoffDate ?? "";
  if (!Number.isFinite(initialRating) || initialRating < 0 || initialRating > 4000) {
    throw new RangeError("initialRating must be between 0 and 4000");
  }
  if (!Number.isFinite(kFactor) || kFactor <= 0 || kFactor > 100) {
    throw new RangeError("kFactor must be in (0, 100]");
  }
  if (!Number.isFinite(homeAdvantage) || homeAdvantage < -500 || homeAdvantage > 500) {
    throw new RangeError("homeAdvantage must be between -500 and 500");
  }
  if (cutoffDate && !validIsoDate(cutoffDate)) {
    throw new TypeError("cutoffDate must use YYYY-MM-DD");
  }

  const eligible = matches.map((match, index) => ({ match, index }))
    .filter(({ match }) => match && validIsoDate(match.date) &&
      Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
      Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
      typeof match.homeTeam === "string" && match.homeTeam.trim() &&
      typeof match.awayTeam === "string" && match.awayTeam.trim() &&
      match.homeTeam !== match.awayTeam &&
      (!cutoffDate || match.date < cutoffDate))
    .sort((a, b) => a.match.date.localeCompare(b.match.date) || a.index - b.index);

  if (!eligible.length) throw new RangeError("no valid historical matches before the analysis date");

  const ratings = new Map();
  const getRating = (team) => ratings.has(team) ? ratings.get(team) : initialRating;
  eligible.forEach(({ match }) => {
    const homeRating = getRating(match.homeTeam);
    const awayRating = getRating(match.awayTeam);
    const expectedHomeScore = 1 / (1 + (10 ** ((awayRating - (homeRating + homeAdvantage)) / 400)));
    const actualHomeScore = match.homeGoals > match.awayGoals ? 1
      : match.homeGoals === match.awayGoals ? 0.5 : 0;
    const change = kFactor * (actualHomeScore - expectedHomeScore);
    ratings.set(match.homeTeam, homeRating + change);
    ratings.set(match.awayTeam, awayRating - change);
  });

  const homeRating = getRating(homeTeam);
  const awayRating = getRating(awayTeam);
  const expectedHomeScore = 1 / (1 + (10 ** ((awayRating - (homeRating + homeAdvantage)) / 400)));
  return {
    homeRating,
    awayRating,
    ratingDifference: homeRating - awayRating,
    expectedHomeScore,
    expectedAwayScore: 1 - expectedHomeScore,
    homeAdvantage,
    initialRating,
    kFactor,
    matchesUsed: eligible.length,
    cutoffDate: cutoffDate || null,
    ratings: Object.fromEntries([...ratings.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
}


function validateOutcome(value) {
  if (!["home", "draw", "away"].includes(value)) {
    throw new RangeError("outcome must be home, draw, or away");
  }
}

function validateThreeWayProbabilities(probabilities) {
  if (!probabilities || typeof probabilities !== "object") {
    throw new TypeError("probabilities must be an object");
  }
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError("home, draw, and away probabilities must be between 0 and 1");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new RangeError("three-way probabilities must sum to one");
  }
  return values;
}

function meanLogLoss(rows, outcomes, temperature = 1) {
  const epsilon = 1e-15;
  return rows.reduce((sum, probabilities, index) => {
    const calibrated = applyTemperatureScaling(probabilities, temperature);
    return sum - Math.log(Math.max(epsilon, calibrated[outcomes[index]]));
  }, 0) / rows.length;
}

/** Apply multiclass temperature scaling to a 1X2 probability triplet. */
export function applyTemperatureScaling(probabilities, temperature = 1) {
  const [home, draw, away] = validateThreeWayProbabilities(probabilities);
  if (!Number.isFinite(temperature) || temperature < 0.05 || temperature > 10) {
    throw new RangeError("temperature must be between 0.05 and 10");
  }
  const powered = [home, draw, away].map((value) => value === 0 ? 0 : value ** (1 / temperature));
  const total = powered.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError("temperature scaling could not normalize probabilities");
  }
  return { home: powered[0] / total, draw: powered[1] / total, away: powered[2] / total };
}

/**
 * Fit a single multiclass temperature using only an explicitly supplied
 * chronological calibration sample. Lower log loss is the optimization target.
 */
export function fitTemperatureScaling(probabilityRows, outcomes, options = {}) {
  if (!Array.isArray(probabilityRows) || !Array.isArray(outcomes) ||
      probabilityRows.length !== outcomes.length) {
    throw new TypeError("probabilityRows and outcomes must be equal-length arrays");
  }
  const minSamples = options.minSamples ?? 10;
  if (!Number.isInteger(minSamples) || minSamples < 2) {
    throw new RangeError("minSamples must be an integer of at least 2");
  }
  if (probabilityRows.length < minSamples) {
    throw new RangeError(`at least ${minSamples} calibration samples are required`);
  }
  probabilityRows.forEach(validateThreeWayProbabilities);
  outcomes.forEach(validateOutcome);

  const beforeLogLoss = meanLogLoss(probabilityRows, outcomes, 1);
  let left = 0.05;
  let right = 10;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let f1 = meanLogLoss(probabilityRows, outcomes, x1);
  let f2 = meanLogLoss(probabilityRows, outcomes, x2);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    if (f1 <= f2) {
      right = x2;
      x2 = x1;
      f2 = f1;
      x1 = right - ratio * (right - left);
      f1 = meanLogLoss(probabilityRows, outcomes, x1);
    } else {
      left = x1;
      x1 = x2;
      f1 = f2;
      x2 = left + ratio * (right - left);
      f2 = meanLogLoss(probabilityRows, outcomes, x2);
    }
  }
  const temperature = (left + right) / 2;
  const afterLogLoss = meanLogLoss(probabilityRows, outcomes, temperature);
  return {
    temperature,
    sampleSize: probabilityRows.length,
    beforeLogLoss,
    afterLogLoss,
    improved: afterLogLoss < beforeLogLoss - 1e-12
  };
}

function calculateForecastMetrics(predictions, probabilityKey) {
  if (!predictions.length) return null;
  let logLoss = 0;
  let brierScore = 0;
  let correct = 0;
  predictions.forEach((prediction) => {
    const probabilities = prediction[probabilityKey];
    const actual = prediction.actual;
    const actualProbability = probabilities[actual];
    logLoss -= Math.log(Math.max(1e-15, actualProbability));
    brierScore += ["home", "draw", "away"].reduce((sum, outcome) =>
      sum + (probabilities[outcome] - (outcome === actual ? 1 : 0)) ** 2, 0);
    const predicted = ["home", "draw", "away"].reduce((best, outcome) =>
      probabilities[outcome] > probabilities[best] ? outcome : best, "home");
    if (predicted === actual) correct += 1;
  });
  return {
    sampleSize: predictions.length,
    logLoss: logLoss / predictions.length,
    brierScore: brierScore / predictions.length,
    accuracy: correct / predictions.length
  };
}


/**
 * One-vs-rest reliability bins for each 1X2 outcome.
 * Empty bins are retained so charts share a stable 0..1 axis.
 */
export function calculateReliabilityBins(predictions, probabilityKey = "calibrated", binCount = 10) {
  if (!Array.isArray(predictions)) throw new TypeError("predictions must be an array");
  if (!["raw", "calibrated"].includes(probabilityKey)) throw new RangeError("probabilityKey must be raw or calibrated");
  if (!Number.isInteger(binCount) || binCount < 2 || binCount > 20) {
    throw new RangeError("binCount must be an integer from 2 to 20");
  }
  const outcomes = ["home", "draw", "away"];
  const result = {};
  for (const outcome of outcomes) {
    const bins = Array.from({ length: binCount }, (_, index) => ({
      lower: index / binCount,
      upper: (index + 1) / binCount,
      count: 0,
      predictedSum: 0,
      observedSum: 0
    }));
    for (const prediction of predictions) {
      const probabilities = prediction?.[probabilityKey];
      validateThreeWayProbabilities(probabilities);
      validateOutcome(prediction.actual);
      const probability = probabilities[outcome];
      const index = Math.min(binCount - 1, Math.floor(probability * binCount));
      bins[index].count += 1;
      bins[index].predictedSum += probability;
      bins[index].observedSum += prediction.actual === outcome ? 1 : 0;
    }
    const total = predictions.length;
    const populated = bins.map((bin) => ({
      lower: bin.lower,
      upper: bin.upper,
      count: bin.count,
      meanPredicted: bin.count ? bin.predictedSum / bin.count : null,
      observedRate: bin.count ? bin.observedSum / bin.count : null
    }));
    const ece = total ? bins.reduce((sum, bin) =>
      sum + Math.abs((bin.count ? bin.predictedSum / bin.count : 0) -
        (bin.count ? bin.observedSum / bin.count : 0)) * bin.count, 0) / total : null;
    const mce = total ? Math.max(0, ...bins.filter((bin) => bin.count).map((bin) =>
      Math.abs(bin.predictedSum / bin.count - bin.observedSum / bin.count))) : null;
    result[outcome] = { bins: populated, expectedCalibrationError: ece, maximumCalibrationError: mce, sampleSize: total };
  }
  return result;
}

/** Per-league scorecards use only each fixture's out-of-sample forecast. */
export function evaluatePerformanceByLeague(predictions) {
  if (!Array.isArray(predictions)) throw new TypeError("predictions must be an array");
  const groups = new Map();
  predictions.forEach((prediction) => {
    const league = typeof prediction.league === "string" && prediction.league.trim()
      ? prediction.league.trim() : "Unknown league";
    if (!groups.has(league)) groups.set(league, []);
    groups.get(league).push(prediction);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([league, rows]) => {
    const calibratedOnly = rows.filter((item) => item.calibrationStatus === "fitted_on_prior_forecasts");
    return {
      league,
      sampleSize: rows.length,
      rawMetrics: calculateForecastMetrics(rows, "raw"),
      calibratedMetrics: calculateForecastMetrics(rows, "calibrated"),
      calibrationMetrics: calculateForecastMetrics(calibratedOnly, "calibrated"),
      calibrationSamples: calibratedOnly.length
    };
  });
}

/**
 * Expanding-window, date-ordered evaluation. Every fixture is predicted using
 * strictly earlier calendar dates; calibration uses only earlier out-of-sample
 * forecasts. Same-day fixtures are never allowed into one another's training set.
 */
export function walkForwardBacktest(matches, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  const minTrainingMatches = options.minTrainingMatches ?? 30;
  const minTeamAppearances = options.minTeamAppearances ?? 5;
  const calibrationMinSamples = options.calibrationMinSamples ?? 20;
  const rho = options.rho ?? -0.08;
  const maxGoals = options.maxGoals ?? 12;
  const recencyDecay = options.recencyDecay ?? 0.95;
  const priorMatches = options.priorMatches ?? 5;
  const homeAdvantage = options.homeAdvantage ?? 60;
  const kFactor = options.kFactor ?? 20;
  if (!Number.isInteger(minTrainingMatches) || minTrainingMatches < 1) {
    throw new RangeError("minTrainingMatches must be a positive integer");
  }
  if (!Number.isInteger(minTeamAppearances) || minTeamAppearances < 1) {
    throw new RangeError("minTeamAppearances must be a positive integer");
  }
  if (!Number.isInteger(calibrationMinSamples) || calibrationMinSamples < 2) {
    throw new RangeError("calibrationMinSamples must be at least 2");
  }
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
    throw new RangeError("rho must be between -1 and 1");
  }
  const eligible = matches.filter((match) => match && validIsoDate(match.date) &&
    Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
    Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
    typeof match.homeTeam === "string" && match.homeTeam.trim() &&
    typeof match.awayTeam === "string" && match.awayTeam.trim() &&
    match.homeTeam !== match.awayTeam)
    .sort((a, b) => a.date.localeCompare(b.date));

  const predictions = [];
  const skipped = [];
  for (let index = 0; index < eligible.length; index += 1) {
    const fixture = eligible[index];
    const training = eligible.slice(0, index).filter((match) => match.date < fixture.date);
    if (training.length < minTrainingMatches) {
      skipped.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        reason: "insufficient_prior_matches", trainingMatches: training.length });
      continue;
    }
    const homeAppearances = training.filter((match) =>
      match.homeTeam === fixture.homeTeam || match.awayTeam === fixture.homeTeam).length;
    const awayAppearances = training.filter((match) =>
      match.homeTeam === fixture.awayTeam || match.awayTeam === fixture.awayTeam).length;
    if (homeAppearances < minTeamAppearances || awayAppearances < minTeamAppearances) {
      skipped.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        reason: "insufficient_team_history", homeAppearances, awayAppearances });
      continue;
    }
    try {
      const lambdas = estimateLambdas(training, fixture.homeTeam, fixture.awayTeam, {
        limit: 20, recencyDecay, priorMatches, cutoffDate: fixture.date
      });
      const matrix = dixonColesScoreMatrix(lambdas.lambdaHome, lambdas.lambdaAway, rho, maxGoals);
      const raw = matchProbabilities(matrix);
      const actual = fixture.homeGoals > fixture.awayGoals ? "home"
        : fixture.homeGoals === fixture.awayGoals ? "draw" : "away";

      // Calibrator only sees forecasts that occurred strictly before this fixture's date.
      const priorCalibration = predictions.filter((item) => item.date < fixture.date);
      let temperature = 1;
      let calibrationStatus = "warming_up";
      if (priorCalibration.length >= calibrationMinSamples) {
        const fitted = fitTemperatureScaling(
          priorCalibration.map((item) => item.raw),
          priorCalibration.map((item) => item.actual),
          { minSamples: calibrationMinSamples }
        );
        temperature = fitted.temperature;
        calibrationStatus = "fitted_on_prior_forecasts";
      }
      const calibrated = applyTemperatureScaling(
        { home: raw.home, draw: raw.draw, away: raw.away }, temperature
      );
      let elo = null;
      try {
        const rating = estimateElo(training, fixture.homeTeam, fixture.awayTeam, {
          homeAdvantage, kFactor, cutoffDate: fixture.date
        });
        elo = { homeRating: rating.homeRating, awayRating: rating.awayRating,
          ratingDifference: rating.ratingDifference, expectedHomeScore: rating.expectedHomeScore };
      } catch {
        // Elo is a diagnostic alongside the primary Poisson/DC forecast.
      }
      predictions.push({
        date: fixture.date,
        league: typeof fixture.league === "string" && fixture.league.trim() ? fixture.league.trim() : "Unknown league",
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        homeGoals: fixture.homeGoals,
        awayGoals: fixture.awayGoals,
        actual,
        raw: { home: raw.home, draw: raw.draw, away: raw.away },
        calibrated,
        lambdaHome: lambdas.lambdaHome,
        lambdaAway: lambdas.lambdaAway,
        trainingMatches: training.length,
        homeAppearances,
        awayAppearances,
        calibrationTemperature: temperature,
        calibrationStatus,
        elo
      });
    } catch (error) {
      skipped.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        reason: "model_error", message: error.message });
    }
  }

  const calibratedPredictions = predictions.filter((item) => item.calibrationStatus === "fitted_on_prior_forecasts");
  return {
    predictions,
    skipped,
    totalValidFixtures: eligible.length,
    evaluated: predictions.length,
    skippedCount: skipped.length,
    calibrationSamples: calibratedPredictions.length,
    rawMetrics: calculateForecastMetrics(predictions, "raw"),
    calibratedMetrics: calculateForecastMetrics(predictions, "calibrated"),
    calibrationMetrics: calculateForecastMetrics(calibratedPredictions, "calibrated"),
    reliability: calculateReliabilityBins(calibratedPredictions, "calibrated", options.calibrationBinCount ?? 10),
    reliabilityRaw: calculateReliabilityBins(predictions, "raw", options.calibrationBinCount ?? 10),
    leagueMetrics: evaluatePerformanceByLeague(predictions),
    settings: { minTrainingMatches, minTeamAppearances, calibrationMinSamples, rho, maxGoals,
      recencyDecay, priorMatches, homeAdvantage, kFactor }
  };
}
/**
 * Walk-forward validation of posterior-predictive score intervals.
 * Every interval is fitted only from fixtures strictly before its target date.
 * Coverage is measured on realized home goals, away goals, total goals and goal difference.
 */
export function walkForwardPredictiveIntervalBacktest(matches, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  const iterations = options.intervalIterations ?? 100;
  const confidenceLevel = options.confidenceLevel ?? 0.9;
  if (!Number.isInteger(iterations) || iterations < 50 || iterations > 1000) {
    throw new RangeError("intervalIterations must be an integer from 50 to 1000");
  }
  if (!Number.isFinite(confidenceLevel) || confidenceLevel <= 0.5 || confidenceLevel >= 1) {
    throw new RangeError("confidenceLevel must be between 0.5 and 1");
  }
  const base = walkForwardBacktest(matches, options);
  const predictions = [];
  const skipped = [];
  for (const forecast of base.predictions) {
    const training = matches.filter((match) => match && validIsoDate(match.date) && match.date < forecast.date &&
      Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
      Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
      typeof match.homeTeam === "string" && typeof match.awayTeam === "string");
    const seedText = `${forecast.date}|${forecast.homeTeam}|${forecast.awayTeam}`;
    const seed = [...seedText].reduce((value, char) =>
      Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    try {
      const result = estimateProbabilityIntervals(training, forecast.homeTeam, forecast.awayTeam, {
        cutoffDate: forecast.date, iterations, confidenceLevel,
        rho: options.rho ?? -0.08, maxGoals: options.maxGoals ?? 12, seed
      });
      predictions.push({ ...forecast, predictiveIntervals: result.predictiveIntervals,
        intervalIterations: result.successfulIterations, intervalCutoffDate: result.cutoffDate });
    } catch (error) {
      skipped.push({ date: forecast.date, homeTeam: forecast.homeTeam,
        awayTeam: forecast.awayTeam, reason: error.message });
    }
  }
  const measures = {
    homeGoals: (row) => row.homeGoals,
    awayGoals: (row) => row.awayGoals,
    totalGoals: (row) => row.homeGoals + row.awayGoals,
    goalDifference: (row) => row.homeGoals - row.awayGoals
  };
  const coverage = Object.fromEntries(Object.entries(measures).map(([key, actualValue]) => {
    const rows = predictions.filter((row) => row.predictiveIntervals?.[key]);
    const hits = rows.filter((row) => {
      const interval = row.predictiveIntervals[key];
      const actual = actualValue(row);
      return actual >= interval.lower && actual <= interval.upper;
    }).length;
    const meanWidth = rows.length ? rows.reduce((sum, row) =>
      sum + row.predictiveIntervals[key].upper - row.predictiveIntervals[key].lower, 0) / rows.length : null;
    return [key, { sampleSize: rows.length, covered: hits,
      empiricalCoverage: rows.length ? hits / rows.length : null, meanWidth }];
  }));
  return { confidenceLevel, iterations, predictions, skipped, evaluated: predictions.length,
    skippedCount: skipped.length, coverage, baseBacktest: base };
}

