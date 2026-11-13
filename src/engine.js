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
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
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
