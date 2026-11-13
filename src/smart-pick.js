import { evaluateMarket } from "./markets.js";

const OUTCOME_RETURNS = (odds) => ({
  win: odds - 1,
  halfWin: (odds - 1) / 2,
  push: 0,
  halfLoss: -0.5,
  loss: -1,
  split: (odds - 2) / 2
});

function validateOptions(options) {
  const config = {
    minProbability: options.minProbability ?? 0.4,
    minExpectedValue: options.minExpectedValue ?? 0.02,
    fractionalKelly: options.fractionalKelly ?? 0.25,
    maxStakeFraction: options.maxStakeFraction ?? 0.02,
    minOdds: options.minOdds ?? 1.01,
    maxOdds: options.maxOdds ?? 20
  };
  for (const key of ["minProbability", "fractionalKelly", "maxStakeFraction"]) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 1) {
      throw new RangeError(key + " must be between 0 and 1");
    }
  }
  if (!Number.isFinite(config.minExpectedValue)) throw new RangeError("minExpectedValue must be finite");
  if (!Number.isFinite(config.minOdds) || config.minOdds <= 1) throw new RangeError("minOdds must be greater than 1");
  if (!Number.isFinite(config.maxOdds) || config.maxOdds < config.minOdds) throw new RangeError("maxOdds must be at least minOdds");
  return config;
}

/**
 * Rank priced market candidates by expected value, then probability of a
 * positive settlement. The selector returns NO BET unless every configured
 * probability, value, price and stake-risk gate is satisfied.
 *
 * Candidate: { id?, descriptor, odds }. Stake fraction is a fraction of the
 * bankroll, not a currency amount. EV is net expected return per unit staked.
 */
export function rankSmartPicks(matrix, candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");
  const config = validateOptions(options);
  const evaluated = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || !candidate.descriptor) {
      throw new TypeError("each candidate requires a market descriptor");
    }
    const id = candidate.id ?? "candidate-" + (index + 1);
    const odds = Number(candidate.odds);
    const reasons = [];
    const blockingReasons = [];
    if (!Number.isFinite(odds) || odds <= 1) {
      return { id, descriptor: candidate.descriptor, odds: candidate.odds ?? null,
        eligible: false, reasons: ["Odds belum tersedia atau tidak valid."], expectedValue: null,
        probability: null, fairOdds: null, kellyFraction: null, stakeFraction: 0 };
    }
    const priced = evaluateMarket(matrix, candidate.descriptor, odds);
    const returns = OUTCOME_RETURNS(odds);
    const probability = Object.entries(priced.outcomes).reduce((sum, [outcome, chance]) =>
      sum + (returns[outcome] > 0 ? chance : 0), 0);
    const nonLossProbability = Object.entries(priced.outcomes).reduce((sum, [outcome, chance]) =>
      sum + (returns[outcome] >= -1e-12 ? chance : 0), 0);
    const reject = (reason) => { reasons.push(reason); blockingReasons.push(reason); };
    if (odds < config.minOdds || odds > config.maxOdds) reject("Odds di luar batas yang diizinkan.");
    if (probability < config.minProbability) reject("Probabilitas hasil positif di bawah batas minimum.");
    if (priced.expectedValue < config.minExpectedValue) reject("EV di bawah ambang minimum.");
    if (!(priced.kellyFraction > 0)) reject("Kelly tidak positif; tidak ada keunggulan harga yang layak.");
    const rawStakeFraction = priced.kellyFraction * config.fractionalKelly;
    const stakeFraction = Math.min(rawStakeFraction, config.maxStakeFraction);
    if (!(stakeFraction > 0)) reject("Ukuran stake setelah pembatasan risiko adalah nol.");
    if (stakeFraction < rawStakeFraction) reasons.push("Stake dibatasi oleh batas maksimum bankroll.");
    const eligible = blockingReasons.length === 0;
    const explanation = [
      "EV " + (priced.expectedValue * 100).toFixed(2) + "%",
      "probabilitas hasil positif " + (probability * 100).toFixed(1) + "%",
      "fair odds " + (priced.fairOdds === null ? "—" : priced.fairOdds.toFixed(2)),
      "stake " + (stakeFraction * 100).toFixed(2) + "% bankroll"
    ];
    return {
      id, descriptor: candidate.descriptor, odds, eligible, reasons,
      expectedValue: priced.expectedValue, probability, nonLossProbability,
      fairOdds: priced.fairOdds, kellyFraction: priced.kellyFraction,
      stakeFraction, explanation
    };
  });

  const ranked = evaluated.filter((item) => item.eligible).sort((a, b) => {
    const evDifference = b.expectedValue - a.expectedValue;
    if (Math.abs(evDifference) > 1e-12) return evDifference;
    const probabilityDifference = b.probability - a.probability;
    if (Math.abs(probabilityDifference) > 1e-12) return probabilityDifference;
    return a.stakeFraction - b.stakeFraction || a.id.localeCompare(b.id);
  }).map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    status: ranked.length ? "BET" : "NO_BET",
    best: ranked[0] ?? null,
    ranked,
    rejected: evaluated.filter((item) => !item.eligible),
    criteria: config,
    reason: ranked.length
      ? "Kandidat lolos seluruh batas EV, probabilitas, odds, dan risiko."
      : "NO BET: tidak ada kandidat yang memenuhi seluruh syarat. Jangan memaksakan pilihan."
  };
}
