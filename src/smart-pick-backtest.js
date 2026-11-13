import { estimateLambdas, dixonColesScoreMatrix } from "./engine.js";
import { settleMarketBet } from "./markets.js";
import { rankSmartPicks, validateSmartPickOptions } from "./smart-pick.js";

function isFixture(match) {
  return match && typeof match.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(match.date) &&
    (() => { const d = new Date(match.date + "T00:00:00.000Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === match.date; })() &&
    Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
    Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
    typeof match.homeTeam === "string" && match.homeTeam.trim() &&
    typeof match.awayTeam === "string" && match.awayTeam.trim() &&
    match.homeTeam !== match.awayTeam;
}

function summarize(bets, initialBankroll, finalBankroll, maxDrawdown, maxDrawdownAmount, clvRows) {
  const totalStake = bets.reduce((sum, bet) => sum + bet.stake, 0);
  const netProfit = bets.reduce((sum, bet) => sum + bet.profit, 0);
  const clvStake = clvRows.reduce((sum, row) => sum + row.stake, 0);
  return {
    bets: bets.length,
    totalStake,
    netProfit,
    roi: totalStake > 0 ? netProfit / totalStake : null,
    initialBankroll,
    finalBankroll,
    bankrollReturn: initialBankroll > 0 ? (finalBankroll - initialBankroll) / initialBankroll : null,
    maxDrawdown,
    maxDrawdownAmount,
    clvBets: clvRows.length,
    clvStake,
    averageClv: clvStake > 0
      ? clvRows.reduce((sum, row) => sum + row.clv * row.stake, 0) / clvStake
      : null
  };
}

/**
 * Chronological Smart Pick backtest. candidateProvider must return actual
 * historical entry prices and, when available, closing prices for the same
 * fixture/market/selection. It is called only after the fixture's date cutoff.
 * Exactly one highest-ranked eligible pick is placed per fixture; otherwise
 * the fixture is a NO BET. Stakes compound from the current bankroll.
 */
export function walkForwardSmartPickBacktest(matches, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  if (options.candidateProvider !== undefined && typeof options.candidateProvider !== "function") {
    throw new TypeError("candidateProvider must be a function");
  }
  const pickOptions = validateSmartPickOptions(options.pickOptions ?? {});
  const initialBankroll = options.initialBankroll ?? 1000;
  const minTrainingMatches = options.minTrainingMatches ?? 30;
  const minTeamAppearances = options.minTeamAppearances ?? 5;
  const rho = options.rho ?? -0.08;
  const maxGoals = options.maxGoals ?? 12;
  const stake = options.stake ?? null;
  if (!Number.isFinite(initialBankroll) || initialBankroll <= 0) throw new RangeError("initialBankroll must be greater than 0");
  if (!Number.isInteger(minTrainingMatches) || minTrainingMatches < 1) throw new RangeError("minTrainingMatches must be a positive integer");
  if (!Number.isInteger(minTeamAppearances) || minTeamAppearances < 1) throw new RangeError("minTeamAppearances must be a positive integer");
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) throw new RangeError("rho must be between -1 and 1");
  if (!Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 20) throw new RangeError("maxGoals must be from 1 to 20");
  if (stake !== null && (!Number.isFinite(stake) || stake <= 0)) throw new RangeError("fixed stake must be greater than 0");

  const fixtures = matches.filter(isFixture).map((match, index) => ({ ...match, _index: index }))
    .sort((a, b) => a.date.localeCompare(b.date) || a._index - b._index);
  let bankroll = initialBankroll;
  let peakBankroll = initialBankroll;
  let maxDrawdown = 0;
  let maxDrawdownAmount = 0;
  const bets = [];
  const noBets = [];
  const equityCurve = [];
  const clvRows = [];

  for (const fixture of fixtures) {
    const training = fixtures.filter((prior) => prior.date < fixture.date);
    const homeAppearances = training.filter((m) => m.homeTeam === fixture.homeTeam || m.awayTeam === fixture.homeTeam).length;
    const awayAppearances = training.filter((m) => m.homeTeam === fixture.awayTeam || m.awayTeam === fixture.awayTeam).length;
    if (training.length < minTrainingMatches || homeAppearances < minTeamAppearances || awayAppearances < minTeamAppearances) {
      noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        reason: training.length < minTrainingMatches ? "insufficient_prior_matches" : "insufficient_team_history" });
      continue;
    }
    if (typeof options.candidateProvider !== "function") {
      noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, reason: "missing_historical_odds_provider" });
      continue;
    }
    try {
      const lambda = estimateLambdas(training, fixture.homeTeam, fixture.awayTeam, {
        limit: 20, recencyDecay: 0.95, priorMatches: 5, cutoffDate: fixture.date
      });
      const matrix = dixonColesScoreMatrix(lambda.lambdaHome, lambda.lambdaAway, rho, maxGoals);
      const prediction = {
        date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        lambdaHome: lambda.lambdaHome, lambdaAway: lambda.lambdaAway,
        trainingMatches: training.length, homeAppearances, awayAppearances
      };
      const candidates = options.candidateProvider(fixture, prediction);
      if (!Array.isArray(candidates)) throw new TypeError("candidateProvider must return an array");
      if (!candidates.length) {
        noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, reason: "no_priced_candidates" });
        continue;
      }
      const selection = rankSmartPicks(matrix, candidates, pickOptions);
      if (selection.status !== "BET" || !selection.best) {
        noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
          reason: "no_candidate_passed_smart_pick", rejected: selection.rejected.length });
        continue;
      }
      const pick = selection.best;
      const actualStake = stake ?? bankroll * pick.stakeFraction;
      if (!Number.isFinite(actualStake) || actualStake <= 0 || actualStake > bankroll) {
        noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, reason: "stake_exceeds_available_bankroll" });
        continue;
      }
      const settled = settleMarketBet(pick.descriptor, fixture.homeGoals, fixture.awayGoals, pick.odds, actualStake);
      bankroll += settled.profit;
      peakBankroll = Math.max(peakBankroll, bankroll);
      const drawdownAmount = peakBankroll - bankroll;
      const drawdown = peakBankroll > 0 ? drawdownAmount / peakBankroll : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      maxDrawdownAmount = Math.max(maxDrawdownAmount, drawdownAmount);

      const closingOdds = pick.closingOdds === undefined || pick.closingOdds === null || pick.closingOdds === ""
        ? null : Number(pick.closingOdds);
      const clv = closingOdds !== null && Number.isFinite(closingOdds) && closingOdds > 1
        ? pick.odds / closingOdds - 1 : null;
      const bet = {
        date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        marketId: pick.id, descriptor: pick.descriptor, odds: pick.odds,
        closingOdds: clv === null ? null : closingOdds, clv,
        probability: pick.probability, expectedValue: pick.expectedValue,
        stakeFraction: pick.stakeFraction, stake: actualStake,
        outcome: settled.outcome, profit: settled.profit,
        bankrollAfter: bankroll, drawdown
      };
      bets.push(bet);
      if (clv !== null) clvRows.push({ clv, stake: actualStake });
      equityCurve.push({ date: fixture.date, bankroll, peakBankroll, drawdown });
    } catch (error) {
      noBets.push({ date: fixture.date, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, reason: "evaluation_error: " + error.message });
    }
  }

  return {
    method: "expanding chronological walk-forward; same-day and future fixtures excluded; one best eligible pick per fixture",
    fixtures: fixtures.length,
    evaluatedBets: bets.length,
    noBetFixtures: noBets.length,
    bets,
    noBets,
    equityCurve,
    summary: summarize(bets, initialBankroll, bankroll, maxDrawdown, maxDrawdownAmount, clvRows)
  };
}
