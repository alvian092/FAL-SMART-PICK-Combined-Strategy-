import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SOURCE_COMMIT = "b0948cb558c927c357db4067eac5b37b96d0e4bb";
const EXPECTED_GIT_BLOB_SHA = "9999a4b380b16189825884a8dab4dc869c847f72";
const URL = `https://raw.githubusercontent.com/martj42/international_results/${SOURCE_COMMIT}/results.csv`;

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some(value => value !== "")) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(field);
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function isValidDate(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const response = await fetch(URL);
if (!response.ok) throw new Error(`Could not fetch pinned upstream CSV: HTTP ${response.status}`);
const csv = await response.text();
const bytes = Buffer.from(csv, "utf8");
const gitBlobSha = createHash("sha1").update(Buffer.concat([
  Buffer.from(`blob ${bytes.length}\\0`), bytes
])).digest("hex");
assert.equal(gitBlobSha, EXPECTED_GIT_BLOB_SHA, "Pinned upstream blob changed or raw content was transformed");

const parsed = parseCsv(csv.replace(/^\\uFEFF/, ""));
const header = parsed[0];
const expectedHeader = ["date", "home_team", "away_team", "home_score", "away_score", "tournament", "city", "country", "neutral"];
assert.deepEqual(header, expectedHeader, "Unexpected upstream CSV schema");
const index = Object.fromEntries(header.map((name, i) => [name, i]));
const rows = parsed.slice(1).filter(row => row.some(value => value !== ""));
const seen = new Map();
const exactRows = new Set();
const competitions = new Map();
const duplicates = [];
const invalidDates = [];
const invalidScores = [];
const blankRows = [];
const invalidNeutral = [];
const over30 = [];
let minDate = "9999-99-99", maxDate = "0000-00-00";

for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  const line = i + 2;
  const date = row[index.date];
  const home = row[index.home_team];
  const away = row[index.away_team];
  const homeScore = row[index.home_score];
  const awayScore = row[index.away_score];
  const tournament = row[index.tournament];
  if (row.length !== header.length || row.some(value => value === "")) blankRows.push(line);
  if (!isValidDate(date)) invalidDates.push({ line, value: date });
  if (date < minDate) minDate = date;
  if (date > maxDate) maxDate = date;
  for (const [side, score] of [["home", homeScore], ["away", awayScore]]) {
    if (!/^\\d+$/.test(score) || !Number.isSafeInteger(Number(score)) || Number(score) < 0) {
      invalidScores.push({ line, side, value: score });
    } else if (Number(score) > 30) {
      over30.push({ line, date, home, away, side, score: Number(score), tournament });
    }
  }
  if (!["TRUE", "FALSE"].includes(row[index.neutral])) invalidNeutral.push({ line, value: row[index.neutral] });
  const key = [date, home, away, tournament].join("|");
  if (seen.has(key)) duplicates.push({ key, firstLine: seen.get(key), duplicateLine: line });
  else seen.set(key, line);
  const exact = row.join("\\u001f");
  if (exactRows.has(exact)) throw new Error(`Exact duplicate CSV row at line ${line}`);
  exactRows.add(exact);
  competitions.set(tournament, (competitions.get(tournament) ?? 0) + 1);
}

const friendlyExact = rows.filter(row => row[index.tournament].toLowerCase() === "friendly").length;
const friendlyOther = [...competitions.entries()]
  .filter(([name]) => /friend/i.test(name) && name.toLowerCase() !== "friendly")
  .reduce((sum, [, count]) => sum + count, 0);

assert.equal(rows.length, 49940, "Pinned source row count changed");
assert.equal(minDate, "1872-11-30");
assert.equal(maxDate, "2026-10-06");
assert.equal(competitions.size, 225);
assert.equal(friendlyExact, 18258);
assert.equal(friendlyOther, 106);
assert.equal(invalidDates.length, 0);
assert.equal(invalidScores.length, 0);
assert.equal(blankRows.length, 0);
assert.equal(invalidNeutral.length, 0);
assert.equal(duplicates.length, 1);
assert.equal(over30.length, 1);
assert.equal(over30[0].home, "Australia");
assert.equal(over30[0].away, "American Samoa");
assert.equal(over30[0].score, 31);

const competitionSummary = [...competitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(JSON.stringify({
  source: "martj42/international_results",
  sourceCommit: SOURCE_COMMIT,
  gitBlobSha,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  schema: header,
  rows: rows.length,
  dateRange: { first: minDate, last: maxDate },
  competitionLabels: competitions.size,
  friendly: { exactFriendly: friendlyExact, otherLabelsContainingFriend: friendlyOther },
  duplicateFixtureKeys: duplicates,
  invalidDates: invalidDates.length,
  invalidScores: invalidScores.length,
  blankRows: blankRows.length,
  invalidNeutral: invalidNeutral.length,
  scoresAbove30: over30,
  genderAndAgeScope: "Source README: men's full internationals only; excludes women's, Olympic, U23, B-team and league-select fixtures.",
  fifaStatus: "Not represented by a dedicated verified field; do not infer FIFA sanctioning from tournament names.",
  topCompetitions: competitionSummary
}, null, 2));
