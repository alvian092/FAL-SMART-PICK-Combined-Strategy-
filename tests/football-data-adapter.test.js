import test from "node:test";
import assert from "node:assert/strict";
import { parseFootballDataCsv } from "../src/football-data-adapter.js";
import { parseHistoricalCsv } from "../src/historical.js";
import { parseHistoricalOddsCsv } from "../src/odds-history.js";

const csv = [
  "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,B365CH,B365CD,B365CA",
  "E0,15/08/25,Liverpool,Bournemouth,4,2,1.35,5.2,8.5,1.30,5.4,9.0",
  "E0,16/08/25,Man United,Arsenal,1,1,2.8,3.2,2.5,2.9,3.1,2.4",
  "E0,17/08/25,Incomplete,Fixture,,,,,,,,",
  "E0,15/08/25,Liverpool,Bournemouth,2,0,1.4,5,8,1.3,5.2,9"
].join("\n");

test("converts Football-Data results to the exact FAL historical schema", () => {
  const result = parseFootballDataCsv(csv, { division: "E0", seasonCode: "2526" });
  assert.equal(result.summary.validMatches, 2);
  assert.equal(result.summary.rejectedRows, 2);
  assert.match(result.resultsCsv.split("\n")[0], /^date,league,season,home_team,away_team,home_goals,away_goals$/);
  assert.match(result.resultsCsv, /2025-08-15,England Premier League,2025-2026,Liverpool,Bournemouth,4,2/);
  assert.equal(result.matches[0].homeGoals, 4);
});

test("extracts opening and closing 1X2 quotes but never fabricates UTC timestamps", () => {
  const result = parseFootballDataCsv(csv, { division: "E0", seasonCode: "2526" });
  assert.equal(result.odds.length, 6);
  assert.equal(result.odds[0].bookmaker, "Bet365");
  assert.equal(result.odds[0].odds, 1.35);
  assert.equal(result.odds[0].closingOdds, 1.3);
  assert.equal(result.summary.timestampedEntryQuotes, 0);
  assert.match(result.oddsCsv.split("\n")[0], /^date,league,home_team,away_team,market,selection,odds,closing_odds,bookmaker$/);
});

test("supports BOM, quoted team names and two-digit dates", () => {
  const input = "\uFEFFDiv,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A\nE0,01/09/25,\"Alpha, FC\",Beta,0,0,2.1,3.2,3.4";
  const result = parseFootballDataCsv(input, { division: "E0", season: "2025-2026" });
  assert.equal(result.matches[0].date, "2025-09-01");
  assert.equal(result.matches[0].homeTeam, "Alpha, FC");
  assert.equal(result.odds.length, 3);
});

test("rejects malformed headers and requires an explicit league and season", () => {
  assert.throws(() => parseFootballDataCsv("Date,HomeTeam\n01/01/25,A"), /League is required/i);
});

test("derives pre-2000 season labels correctly and reads row-level Season values", () => {
  const input = [
    "Div,Date,Season,HomeTeam,AwayTeam,FTHG,FTAG",
    "SC0,01/08/93,1993/1994,Alpha,Beta,1,0"
  ].join("\n");
  const result = parseFootballDataCsv(input, { division: "SC0" });
  assert.equal(result.matches[0].season, "1993-1994");
});

test("adapter outputs round-trip through both native FAL CSV importers", () => {
  const converted = parseFootballDataCsv(csv, { division: "E0", seasonCode: "2526" });
  const results = parseHistoricalCsv(converted.resultsCsv);
  const odds = parseHistoricalOddsCsv(converted.oddsCsv);
  assert.equal(results.matches.length, 2);
  assert.equal(odds.rows.length, 6);
  assert.ok(odds.rows.every(row => row.kickoffUtc === null && row.oddsTimestampUtc === null));
  assert.ok(odds.rows.every(row => row.closingOdds !== null && row.closingOddsTimestampUtc === null));
});

test("maps 1993/94 and 1999/00 season codes without shifting them into 2000s", () => {
  const source = [
    "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG",
    "E0,01/08/93,Alpha,Beta,1,0"
  ].join("\n");
  const old = parseFootballDataCsv(source, { division: "E0", seasonCode: "9394" });
  assert.equal(old.matches[0].season, "1993-1994");
  const millennium = parseFootballDataCsv(source, { division: "E0", seasonCode: "9900" });
  assert.equal(millennium.matches[0].season, "1999-2000");
});
