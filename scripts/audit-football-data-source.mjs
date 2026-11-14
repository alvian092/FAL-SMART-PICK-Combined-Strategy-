import assert from "node:assert/strict";
import { parseFootballDataCsv } from "../src/football-data-adapter.js";
import { parseHistoricalCsv } from "../src/historical.js";
import { parseHistoricalOddsCsv } from "../src/odds-history.js";
import { walkForwardSmartPickBacktest } from "../src/smart-pick-backtest.js";

// Public mirrors of Football-Data.co.uk's original season CSVs.
// The full source files are fetched at runtime; no raw match dataset is committed.
const seasons = [
  {
    code: "2324",
    label: "2023-2024",
    url: "https://raw.githubusercontent.com/Airmiz/premier-league-forecast/main/data/football-data/E0_2023-24.csv"
  },
  {
    code: "2425",
    label: "2024-2025",
    url: "https://raw.githubusercontent.com/Airmiz/premier-league-forecast/main/data/football-data/E0_2024-25.csv"
  }
];

const allMatches = [];
const allOdds = [];
const audit = [];

for (const season of seasons) {
  const response = await fetch(season.url);
  if (!response.ok) throw new Error(`Could not fetch ${season.label}: HTTP ${response.status}`);
  const sourceCsv = await response.text();
  const converted = parseFootballDataCsv(sourceCsv, {
    division: "E0",
    seasonCode: season.code,
    bookmaker: "Bet365"
  });

  assert.equal(converted.summary.sourceRows, 380, `${season.label}: unexpected source row count`);
  assert.equal(converted.summary.validMatches, 380, `${season.label}: invalid or missing result rows`);
  assert.equal(converted.summary.rejectedRows, 0, `${season.label}: rejected source rows`);
  assert.equal(converted.summary.oddsQuotes, 1140, `${season.label}: expected three Bet365 1X2 prices per match`);

  const results = parseHistoricalCsv(converted.resultsCsv);
  const odds = parseHistoricalOddsCsv(converted.oddsCsv);
  assert.equal(results.matches.length, 380);
  assert.equal(odds.errors.length, 0, `${season.label}: odds importer errors`);
  assert.equal(odds.rows.length, 1140);
  assert.ok(odds.rows.every(row => row.kickoffUtc === null && row.oddsTimestampUtc === null));
  assert.ok(odds.rows.every(row => row.closingOdds !== null && row.closingOddsTimestampUtc === null));

  allMatches.push(...results.matches);
  allOdds.push(...odds.rows);
  audit.push({
    season: season.label,
    sourceRows: converted.summary.sourceRows,
    validResults: results.matches.length,
    oddsQuotes: odds.rows.length,
    rejectedResults: converted.summary.rejectedRows,
    rejectedOdds: odds.errors.length,
    completeOpening1x2: true,
    completeClosing1x2: true,
    quoteTimestamps: "not supplied by source; CLV disabled"
  });
}

const oddsByFixture = new Map();
for (const row of allOdds) {
  const key = [row.date, row.league.toLocaleLowerCase(), row.homeTeam.toLocaleLowerCase(), row.awayTeam.toLocaleLowerCase()].join("|");
  const bucket = oddsByFixture.get(key) ?? [];
  bucket.push(row);
  oddsByFixture.set(key, bucket);
}

const backtest = walkForwardSmartPickBacktest(allMatches, {
  minTrainingMatches: 30,
  minTeamAppearances: 5,
  initialBankroll: 1000,
  pickOptions: {
    minProbability: 0.4,
    minExpectedValue: 0.02,
    fractionalKelly: 0.25,
    maxStakeFraction: 0.02
  },
  candidateProvider: fixture => {
    const key = [fixture.date, fixture.league.toLocaleLowerCase(), fixture.homeTeam.toLocaleLowerCase(), fixture.awayTeam.toLocaleLowerCase()].join("|");
    return (oddsByFixture.get(key) ?? []).map(row => ({
      id: `Bet365-1X2-${row.selection}`,
      descriptor: row.descriptor,
      odds: row.odds,
      // Closing prices have no per-quote timestamp; never pass them as CLV.
      closingOdds: null
    }));
  }
});

assert.equal(allMatches.length, 760);
assert.equal(allOdds.length, 2280);
assert.equal(backtest.fixtures, 760);
assert.equal(backtest.summary.clvBets, 0);
assert.ok(backtest.evaluatedBets + backtest.noBetFixtures === 760);

console.log(JSON.stringify({
  source: "Football-Data.co.uk CSV mirrored on GitHub",
  league: "England Premier League (E0)",
  bookmaker: "Bet365",
  audit,
  combined: {
    fixtures: backtest.fixtures,
    oddsQuotes: allOdds.length,
    evaluatedBets: backtest.evaluatedBets,
    noBetFixtures: backtest.noBetFixtures,
    turnover: Number(backtest.summary.totalStake.toFixed(2)),
    netProfit: Number(backtest.summary.netProfit.toFixed(2)),
    roi: backtest.summary.roi === null ? null : Number((backtest.summary.roi * 100).toFixed(2)),
    finalBankroll: Number(backtest.summary.finalBankroll.toFixed(2)),
    maxDrawdown: Number((backtest.summary.maxDrawdown * 100).toFixed(2)),
    clv: "not calculated: source does not provide timestamped quotes"
  }
}, null, 2));
