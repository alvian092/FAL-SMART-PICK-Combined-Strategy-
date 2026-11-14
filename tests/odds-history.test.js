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
  assert.equal(result.rows[0].clvTimingVerified, false);
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

test("rejects invalid market selections and malformed Asian lines at import time", () => {
  const csv = [
    header,
    "2025-01-01,L,A,B,1x2,homeTeam,,,,,2.1,2.0",
    "2025-01-02,L,A,B,doubleChance,draw,,,,,1.4,1.3",
    "2025-01-03,L,A,B,totalGoals,over,2.3,,,,1.9,1.8",
    "2025-01-04,L,A,B,handicap,,-0.25,,,,2.0,1.9",
    "2025-01-05,L,A,B,btts,maybe,,,,,2.0,1.9"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 5);
});

test("accepts valid double-chance, BTTS, odd-even and correct-score descriptors", () => {
  const csv = [
    header,
    "2025-01-01,L,A,B,doubleChance,homeDraw,,,,,1.4,1.3",
    "2025-01-02,L,A,B,btts,yes,,,,,1.8,1.7",
    "2025-01-03,L,A,B,oddEven,odd,,,,,1.9,1.8",
    "2025-01-04,L,A,B,correctScore,,,,2,1,8.0,7.5"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 4);
  assert.equal(result.errors.length, 0);
});

test("parses timezone-aware timestamps and marks CLV timing verified only with both times", () => {
  const timedHeader = header + ",kickoff_utc,odds_timestamp_utc,closing_odds_timestamp_utc";
  const valid = timedHeader +
    "\n2025-01-01,L,A,B,1x2,home,,,,,2.1,1.9,2025-01-01T20:00:00Z,2025-01-01T12:00:00Z,2025-01-01T19:50:00Z";
  const parsed = parseHistoricalOddsCsv(valid);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].kickoffUtc, "2025-01-01T20:00:00.000Z");
  assert.equal(parsed.rows[0].oddsTimestampUtc, "2025-01-01T12:00:00.000Z");
  assert.equal(parsed.rows[0].closingOddsTimestampUtc, "2025-01-01T19:50:00.000Z");
  assert.equal(parsed.rows[0].clvTimingVerified, true);

  const lateEntry = timedHeader +
    "\n2025-01-01,L,A,B,1x2,home,,,,,2.1,,2025-01-01T20:00:00Z,2025-01-01T20:01:00Z,";
  const rejected = parseHistoricalOddsCsv(lateEntry);
  assert.equal(rejected.rows.length, 0);
  assert.match(rejected.errors[0].message, /before kickoff/i);
});

test("rejects timestamps without timezone, invalid calendar dates and untimed closing CLV claims", () => {
  const timedHeader = header + ",kickoff_utc,odds_timestamp_utc,closing_odds_timestamp_utc";
  const noZone = timedHeader +
    "\n2025-01-01,L,A,B,1x2,home,,,,,2.1,1.9,2025-01-01T20:00:00,2025-01-01T12:00:00Z,";
  const rejected = parseHistoricalOddsCsv(noZone);
  assert.equal(rejected.rows.length, 0);
  assert.match(rejected.errors[0].message, /ISO-8601.*timezone/i);

  const invalidCalendar = timedHeader +
    "\n2025-01-01,L,A,B,1x2,home,,,,,2.1,1.9,2025-02-30T20:00:00Z,2025-01-01T12:00:00Z,";
  assert.equal(parseHistoricalOddsCsv(invalidCalendar).rows.length, 0);

  const untimedClose = header +
    "\n2025-01-01,L,A,B,1x2,home,,,,,2.1,1.9";
  const parsed = parseHistoricalOddsCsv(untimedClose);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].closingOddsTimestampUtc, null);
  assert.equal(parsed.rows[0].clvTimingVerified, false);
});

test("rejects empty numeric fields instead of coercing them to zero", () => {
  const csv = [
    header,
    "2025-01-01,L,A,B,totalGoals,over,,,,,2.0,1.9",
    "2025-01-02,L,A,B,correctScore,,,,,1,8.0,7.5",
    "2025-01-03,L,A,B,correctScore,,,,2,,8.0,7.5"
  ].join("\n");
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 3);
});

test("rejects duplicate headers, malformed quote placement and duplicate price snapshots", () => {
  assert.equal(parseHistoricalOddsCsv("date,date,home_team,away_team,market,selection,odds\n2025-01-01,x,A,B,1x2,home,2").rows.length, 0);
  assert.equal(parseHistoricalOddsCsv(header + '\n2025-01-01,L,Al"pha,B,1x2,home,,,,,2,2').rows.length, 0);
  assert.equal(parseHistoricalOddsCsv(header + '\n2025-01-01,L,"Alpha,B,1x2,home,,,,,2,2').rows.length, 0);

  const duplicate = [
    header,
    "2025-01-01,L,A,B,1x2,home,,,,,2.1,2.0",
    "2025-01-01,L,A,B,1x2,home,,,,,2.1,2.0"
  ].join("\n");
  const result = parseHistoricalOddsCsv(duplicate);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
});

test("preserves national-team metadata and neutral venue classification", () => {
  const nationalHeader = header + ",season,match_type,competition_type,gender,age_category,confederation,neutral_venue,bookmaker,source,source_match_id";
  const csv = nationalHeader +
    '\n2025-06-01,World Cup Qualifying,Indonesia,Japan,1x2,home,,,,,2.1,2.0,2025, national_team,qualifier,male,senior,AFC,true,Pinnacle,provider-x,INT-001';
  const result = parseHistoricalOddsCsv(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].matchType, "national_team");
  assert.equal(result.rows[0].competitionType, "qualifier");
  assert.equal(result.rows[0].confederation, "AFC");
  assert.equal(result.rows[0].neutralVenue, true);
  assert.equal(result.rows[0].bookmaker, "Pinnacle");
  assert.equal(result.rows[0].sourceMatchId, "INT-001");
});

