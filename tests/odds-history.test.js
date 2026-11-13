import test from "node:test";
import assert from "node:assert/strict";
import { parseHistoricalOddsCsv } from "../src/odds-history.js";

const header = "date,league,home_team,away_team,market,selection,line,team,home_goals,away_goals,odds,closing_odds";

test("imports historical odds and closing odds with market descriptors", () => {
  const csv = header + "\n2025-01-01,League A,Alpha,Beta,totalGoals,over,2.5,,,,2.05,1.95";
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].descriptor, { type: "totalGoals", selection: "over", line: 2.5 });
  assert.equal(result.rows[0].odds, 2.05);
  assert.equal(result.rows[0].closingOdds, 1.95);
});

test("supports CRLF, BOM, quoted team names and optional closing prices", () => {
  const csv = "\uFEFF" + header + "\r\n2025-01-02,League B,\"Alpha, FC\",Beta,1x2,home,,,,,2.2,";
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].homeTeam, "Alpha, FC");
  assert.equal(result.rows[0].closingOdds, null);
});

test("parses handicap, team total and correct-score market contracts", () => {
  const csv = [
    header,
    "2025-01-01,L,A,B,handicap,,-0.25,home,,,2.1,2.0",
    "2025-01-02,L,A,B,teamTotal,under,1.5,away,,,1.8,1.9",
    "2025-01-03,L,A,B,correctScore,,,,2,1,8.0,7.5"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0].descriptor, { type: "handicap", line: -0.25, team: "home" });
  assert.deepEqual(result.rows[1].descriptor, { type: "teamTotal", selection: "under", line: 1.5, team: "away" });
  assert.deepEqual(result.rows[2].descriptor, { type: "correctScore", homeGoals: 2, awayGoals: 1 });
});

test("rejects missing headers, invalid odds, invalid dates and unsupported markets", () => {
  assert.equal(parseHistoricalOddsCsv("date,odds\n2025-01-01,2").rows.length, 0);
  const csv = [
    header,
    "2025-02-30,L,A,B,1x2,home,,,,,2,2",
    "2025-01-01,L,A,B,1x2,home,,,,,1,2",
    "2025-01-01,L,A,B,unknown,yes,,,,,2,2"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 3);
});

test("unpriced or invalid closing odds are rejected instead of fabricating CLV", () => {
  const csv = [
    header,
    "2025-01-01,L,A,B,1x2,home,,,,,2,",
    "2025-01-02,L,A,B,1x2,home,,,,,2,1"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].closingOdds, null);
  assert.equal(result.errors.length, 1);
});
