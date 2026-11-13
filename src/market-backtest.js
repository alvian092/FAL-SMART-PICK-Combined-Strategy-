import { estimateLambdas, dixonColesScoreMatrix } from "./engine.js";
import { evaluateMarket, settleMarketBet, summarizeMarketBets } from "./markets.js";

function validFixture(match) {
  return match && typeof match.date === "string" &&
    /^\\d{4}-\\d{2}-\\d{2}$/.test(match.date) &&
    Number.isFinite(Date.parse(match.date + "T00:00:00Z")) &&
    Number.isInteger(match.homeGoals) && match.homeGoals >= 0 &&
    Number.isInteger(match.awayGoals) && match.awayGoals >= 0 &&
    typeof match.homeTeam === "string" && match.homeTeam.trim() &&
    typeof match.awayTeam === "string" && match.awayTeam.trim() &&
    match.homeTeam !== match.awayTeam;
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || typeof descriptor.type !== "string") {
    throw new TypeError("each market descriptor must be an object with a type");
  }
}

/**
 * Chronological out-of-sample backtest for preselected market contracts.
 * Historical odds are never inferred: oddsProvider must supply the price for
 * each fixture/market. Without a price, the forecast is retained but no bet
 * is settled, so score-only CSV files cannot produce fabricated ROI.
 */
export function walkForwardMarketBacktest(matches, descriptors, options = {}) {
  if (!Array.isArray(matches)) throw new TypeError("matches must be an array");
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new TypeError("at least one market descriptor is required");
  }
  descriptors.forEach(validateDescriptor);
  const minTrainingMatches = options.minTrainingMatches ?? 30;
  const minTeamAppearances = options.minTeamAppearances ?? 5;
  const rho = options.rho ?? -0.08;
  const maxGoals = options.maxGoals ?? 12;
  if (!Number.isInteger(minTrainingMatches) || minTrainingMatches < 1) {
    throw new RangeError("minTrainingMatches must be a positive integer");
  }
  if (!Number.isInteger(minTeamAppearances) || minTeamAppearances < 1) {
    throw new RangeError("minTeamAppearances must be a positive integer");
  }
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) throw new RangeError("rho must be between -1 and 1");
  if (!Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 20) throw new RangeError("maxGoals must be from 1 to 20");
  if (options.oddsProvider !== undefined && typeof options.oddsProvider !== "function") {
    throw new TypeError("oddsProvider must be a function when supplied");
  }

  const fixtures = matches.filter(validFixture)
    .map((match, index) => ({ ...match, _sourceIndex: index }))
    .sort((a, b) => a.date.localeCompare(b.date) || a._sourceIndex - b._sourceIndex);
  const reports = descriptors.map((descriptor, index) => ({
    id: descriptor.id ?? `market-${index + 1}`,
    descriptor: { ...descriptor },
    predictions: [],
    skipped: [],
    bets: []
  }));

  for (const fixture of fixtures) {
    const training = fixtures.filter((candidate) => candidate.date < fixture.date);
    for (const report of reports) {
      const { homeTeam, awayTeam, date } = fixture;
      const homeAppearances = training.filter((m) => m.homeTeam === homeTeam || m.awayTeam === homeTeam).length;
      const awayAppearances = training.filter((m) => m.homeTeam === awayTeam || m.awayTeam === awayTeam).length;
      if (training.length < minTrainingMatches) {
        report.skipped.push({ date, homeTeam, awayTeam, reason: "insufficient_prior_matches" });
        continue;
      }
      if (homeAppearances < minTeamAppearances || awayAppearances < minTeamAppearances) {
        report.skipped.push({ date, homeTeam, awayTeam, reason: "insufficient_team_history" });
        continue;
      }
      try {
        const lambda = estimateLambdas(training, homeTeam, awayTeam, {
          limit: 20, recencyDecay: 0.95, priorMatches: 5, cutoffDate: date
        });
        const matrix = dixonColesScoreMatrix(lambda.lambdaHome, lambda.lambdaAway, rho, maxGoals);
        const forecast = evaluateMarket(matrix, report.descriptor);
        const prediction = {
          date, homeTeam, awayTeam, actualHomeGoals: fixture.homeGoals,
          actualAwayGoals: fixture.awayGoals, trainingMatches: training.length,
          homeAppearances, awayAppearances, lambdaHome: lambda.lambdaHome,
          lambdaAway: lambda.lambdaAway, outcomes: forecast.outcomes,
          fairOdds: forecast.fairOdds, actualOutcome: null, odds: null,
          profit: null, settlement: "not_bet"
        };
        const odds = options.oddsProvider
          ? options.oddsProvider(fixture, report.descriptor, prediction)
          : undefined;
        if (odds === undefined || odds === null || odds === "") {
          prediction.settlement = "missing_odds";
        } else {
          const numericOdds = Number(odds);
          const settled = settleMarketBet(report.descriptor, fixture.homeGoals,
            fixture.awayGoals, numericOdds, options.stake ?? 1);
          Object.assign(prediction, {
            odds: numericOdds, actualOutcome: settled.outcome,
            profit: settled.profit, settlement: "settled"
          });
          report.bets.push(settled);
        }
        report.predictions.push(prediction);
      } catch (error) {
        report.skipped.push({ date, homeTeam, awayTeam, reason: error.message });
      }
    }
  }

  return {
    method: "expanding chronological walk-forward; same-day and future fixtures excluded",
    fixtures: fixtures.length,
    markets: reports.map((report) => {
      const summary = summarizeMarketBets(report.bets);
      return {
        id: report.id, descriptor: report.descriptor,
        predictions: report.predictions, skipped: report.skipped,
        evaluated: report.predictions.length,
        missingOdds: report.predictions.filter((p) => p.settlement === "missing_odds").length,
        settledBets: report.bets.length,
        summary
      };
    })
  };
}
