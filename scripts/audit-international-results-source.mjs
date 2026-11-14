import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SOURCES = [
  {
    gender: "men",
    repository: "martj42/international_results",
    commit: "b0948cb558c927c357db4067eac5b37b96d0e4bb",
    blobSha: "9999a4b380b16189825884a8dab4dc869c847f72",
    expected: { rows: 49940, firstDate: "1872-11-30", lastDate: "2026-10-06", competitions: 225, friendly: 18258, friendlyOther: 106, duplicateKeys: 1, over30: 1 }
  },
  {
    gender: "women",
    repository: "martj42/womens-international-results",
    commit: "d2aa1d5e5337881481b04844339f8a43a5f132f2",
    blobSha: "79b2b220e5a430f311258154348090f1fa606a19",
    expected: { rows: 11816, firstDate: "1956-09-23", lastDate: "2026-10-13", competitions: 117, friendly: 1328, friendlyOther: 29, duplicateKeys: 0, over30: 0 }
  }
];

const EXPECTED_HEADER = ["date", "home_team", "away_team", "home_score", "away_score", "tournament", "city", "country", "neutral"];

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function auditSource(source) {
  const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/results.csv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${source.repository}: HTTP ${response.status}`);
  const csv = await response.text();
  const bytes = Buffer.from(csv, "utf8");
  const gitBlobSha = createHash("sha1").update(Buffer.concat([
    Buffer.from(`blob ${bytes.length}\0`), bytes
  ])).digest("hex");
  assert.equal(gitBlobSha, source.blobSha, `${source.gender}: pinned upstream blob changed or raw content was transformed`);

  const parsed = parseCsv(csv.replace(/^\uFEFF/, ""));
  const header = parsed[0];
  assert.deepEqual(header, EXPECTED_HEADER, `${source.gender}: unexpected CSV schema`);
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
  let firstDate = "9999-99-99", lastDate = "0000-00-00";

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
    if (date < firstDate) firstDate = date;
    if (date > lastDate) lastDate = date;
    for (const [side, score] of [["home", homeScore], ["away", awayScore]]) {
      if (!/^\d+$/.test(score) || !Number.isSafeInteger(Number(score)) || Number(score) < 0) {
        invalidScores.push({ line, side, value: score });
      } else if (Number(score) > 30) {
        over30.push({ line, date, home, away, side, score: Number(score), tournament });
      }
    }
    if (!["TRUE", "FALSE"].includes(row[index.neutral])) invalidNeutral.push({ line, value: row[index.neutral] });
    const key = [date, home, away, tournament].join("|");
    if (seen.has(key)) {
      const first = seen.get(key);
      duplicates.push({ key, firstLine: first.line, duplicateLine: line, firstScore: `${first.homeScore}-${first.awayScore}`, duplicateScore: `${homeScore}-${awayScore}`, scoreConflict: first.homeScore !== homeScore || first.awayScore !== awayScore });
    } else seen.set(key, { line, homeScore, awayScore });
    const exact = row.join("\u001f");
    if (exactRows.has(exact)) throw new Error(`${source.gender}: exact duplicate CSV row at line ${line}`);
    exactRows.add(exact);
    competitions.set(tournament, (competitions.get(tournament) ?? 0) + 1);
  }

  const friendly = rows.filter(row => row[index.tournament].toLowerCase() === "friendly").length;
  const friendlyOtherLabels = [...competitions.entries()]
    .filter(([name]) => /friend/i.test(name) && name.toLowerCase() !== "friendly")
    .map(([name, count]) => ({ name, count }));
  const friendlyOther = friendlyOtherLabels.reduce((sum, item) => sum + item.count, 0);
  const olympic = rows.filter(row => /olympic/i.test(row[index.tournament])).length;
  const youthLabels = [...competitions.keys()].filter(name => /u[- ]?(17|19|20|23)|youth|junior/i.test(name));

  assert.equal(rows.length, source.expected.rows, `${source.gender}: source row count changed`);
  assert.equal(firstDate, source.expected.firstDate);
  assert.equal(lastDate, source.expected.lastDate);
  assert.equal(competitions.size, source.expected.competitions);
  assert.equal(friendly, source.expected.friendly);
  assert.equal(friendlyOther, source.expected.friendlyOther);
  assert.equal(duplicates.length, source.expected.duplicateKeys);
  assert.equal(over30.length, source.expected.over30);
  assert.equal(invalidDates.length, 0);
  assert.equal(invalidScores.length, 0);
  assert.equal(blankRows.length, 0);
  assert.equal(invalidNeutral.length, 0);

  return {
    gender: source.gender,
    repository: source.repository,
    commit: source.commit,
    gitBlobSha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    rows: rows.length,
    dateRange: { first: firstDate, last: lastDate },
    competitionLabels: competitions.size,
    friendly: { exactFriendly: friendly, otherLabelsContainingFriend: friendlyOther, otherLabels: friendlyOtherLabels },
    duplicateFixtureKeys: duplicates,
    invalidDates: invalidDates.length,
    invalidScores: invalidScores.length,
    blankRows: blankRows.length,
    invalidNeutral: invalidNeutral.length,
    scoresAbove30: over30,
    olympicTournamentRows: olympic,
    youthLikeTournamentLabels: youthLabels,
    topCompetitions: [...competitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  };
}

const results = [];
for (const source of SOURCES) results.push(await auditSource(source));
const totalRows = results.reduce((sum, item) => sum + item.rows, 0);
assert.equal(totalRows, 61756, "Combined pinned male + female row count does not match the 2026-11-08 Mon Sport Info ingestion count");

console.log(JSON.stringify({
  source: "Pinned upstream CC0/Unlicense national-team results",
  totalRows,
  catalogueCount: 61170,
  latestMonSportInfoIngestionCount: 61756,
  note: "The Mon Sport Info catalogue's displayed 61,170 is stale relative to its 8 Nov 2026 ingestion count. This audit pins the two upstream source CSVs; it is not a byte-for-byte audit of Mon Sport Info's own export.",
  sources: results,
  classificationPolicy: {
    gender: "Assigned by source repository (men vs women), never inferred from team names.",
    friendly: "Exact 'Friendly' label and other tournament labels containing 'friend' are counted separately; competition taxonomy still needs a reviewed mapping.",
    fifaRecognition: "No dedicated verified FIFA-status field in source CSVs; tournament names do not prove FIFA sanctioning. Store evidence-backed verified/not_verified status separately.",
    ageCategory: "No explicit age-category column. Men's source README says full internationals only and excludes U23/B teams/league selections. Women's source README is work-in-progress; youth/age scope cannot be proven from this schema. Olympic-labelled rows are reported separately.",
    clubSeparation: "These source files are national-team data only; do not merge with club datasets."
  }
}, null, 2));
