import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHistoricalCsv,
  getHistoricalLeagues,
  getHistoricalTeams,
  getHeadToHead
} from "../src/historical.js";

const HEADER = "date,league,season,home_team,away_team,home_goals,away_goals";

test("imports valid CSV rows and trims surrounding whitespace", () => {
  const result = parseHistoricalCsv(`${HEADER}\n2025-08-15, Premier League ,2025-2026,Liverpool,Bournemouth,4,2\n`);
  assert.equal(result.totalRows, 1);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0], {
    date: "2025-08-15", league: "Premier League", season: "2025-2026",
    homeTeam: "Liverpool", awayTeam: "Bournemouth", homeGoals: 4, awayGoals: 2
  });
  assert.deepEqual(result.errors, []);
});

test("supports UTF-8 BOM, CRLF, quoted commas and escaped quotes", () => {
  const csv = "\uFEFF" + HEADER + "\r\n2025-08-15,League,2025, \"Town, United\",\"A \"\"B\"\" FC\",1,0\r\n";
  const result = parseHistoricalCsv(csv);
  assert.equal(result.matches[0].homeTeam, "Town, United");
  assert.equal(result.matches[0].awayTeam, 'A "B" FC');
});

test("rejects missing headers, empty files and unclosed quotes", () => {
  assert.throws(() => parseHistoricalCsv(""), /kosong/i);
  assert.throws(() => parseHistoricalCsv("date,home_team\n2025-01-01,A"), /Kolom wajib/i);
  assert.throws(() => parseHistoricalCsv(`${HEADER}\n2025-01-01,League,2025,"A,B,1,0`), /tidak ditutup/i);
});

test("invalid dates, scores, same teams and wrong column counts are reported", () => {
  const csv = [
    HEADER,
    "2025-02-30,League,2025,A,B,1,0",
    "2025-01-01,League,2025,A,B,-1,0",
    "2025-01-01,League,2025,A,A,1,0",
    "2025-01-01,League,2025,A,B,1,0,EXTRA"
  ].join("\n");
  const result = parseHistoricalCsv(csv);
  assert.equal(result.matches.length, 0);
  assert.equal(result.errors.length, 4);
  assert.throws(() => parseHistoricalCsv(csv), /Tidak ada baris valid/i);
});

test("keeps valid rows and reports duplicate fixtures without double counting", () => {
  const csv = [
    HEADER,
    "2025-01-01,League,2025,A,B,1,0",
    "2025-01-01,League,2025,A,B,1,0",
    "2025-01-02,League,2025,B,A,0,2"
  ].join("\n");
  const result = parseHistoricalCsv(csv);
  assert.equal(result.totalRows, 3);
  assert.equal(result.matches.length, 2);
  assert.match(result.errors[0].message, /duplikat/i);
});

test("league and team selectors are derived from imported records", () => {
  const { matches } = parseHistoricalCsv([
    HEADER,
    "2025-01-01,League B,2025,A,B,1,0",
    "2025-01-02,League A,2025,C,A,0,2"
  ].join("\n"));
  assert.deepEqual(getHistoricalLeagues(matches), ["League A", "League B"]);
  assert.deepEqual(getHistoricalTeams(matches, "League B"), ["A", "B"]);
});

test("H2H returns matching fixtures newest first without duplicating data", () => {
  const { matches } = parseHistoricalCsv([
    HEADER,
    "2024-01-01,League,2024,A,B,1,0",
    "2025-01-01,League,2025,B,A,2,2",
    "2025-02-01,Other,2025,A,B,3,1",
    "2025-03-01,League,2025,A,C,0,0"
  ].join("\n"));
  const h2h = getHeadToHead(matches, "A", "B", "League");
  assert.equal(h2h.length, 2);
  assert.equal(h2h[0].date, "2025-01-01");
  assert.equal(matches.length, 4);
  assert.deepEqual(getHeadToHead(matches, "A", "A"), []);
});
