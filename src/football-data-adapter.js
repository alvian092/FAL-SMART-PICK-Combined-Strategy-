const LEAGUES = {
  E0: "England Premier League", E1: "England Championship", E2: "England League One",
  E3: "England League Two", EC: "England National League",
  SC0: "Scotland Premiership", SC1: "Scotland Championship", SC2: "Scotland League One", SC3: "Scotland League Two",
  D1: "Germany Bundesliga", D2: "Germany 2. Bundesliga",
  I1: "Italy Serie A", I2: "Italy Serie B", SP1: "Spain La Liga", SP2: "Spain Segunda",
  F1: "France Ligue 1", F2: "France Ligue 2", N1: "Netherlands Eredivisie",
  B1: "Belgium Pro League", P1: "Portugal Primeira Liga", T1: "Turkey Super Lig", G1: "Greece Super League",
  ARG: "Argentina Primera Division", AUT: "Austria Bundesliga", BRA: "Brazil Serie A",
  CHN: "China Super League", DNK: "Denmark Superliga", FIN: "Finland Veikkausliiga",
  IRL: "Ireland Premier Division", JPN: "Japan J-League", MEX: "Mexico Liga MX",
  NOR: "Norway Eliteserien", POL: "Poland Ekstraklasa", ROU: "Romania Liga I",
  RUS: "Russia Premier League", SWE: "Sweden Allsvenskan", SWZ: "Switzerland Super League", USA: "USA MLS"
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new SyntaxError("CSV contains an unclosed quoted field");
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function dateToIso(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = match[3].length === 4 ? rawYear : rawYear <= 69 ? 2000 + rawYear : 1900 + rawYear;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function seasonFromCode(code) {
  if (!/^\d{4}$/.test(code)) return "";
  const toYear = (part) => Number(part) <= 69 ? 2000 + Number(part) : 1900 + Number(part);
  return `${toYear(code.slice(0, 2))}-${toYear(code.slice(2, 4))}`;
}
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function numberInRange(value, min, max) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function validOdds(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 && parsed <= 1000 ? parsed : null;
}

/**
 * Converts one Football-Data.co.uk league-season CSV into FAL results and
 * date-only opening/closing 1X2 odds. The source does not provide per-quote
 * UTC timestamps, so the adapter never fabricates them or claims timestamped CLV.
 */
export function parseFootballDataCsv(input, options = {}) {
  if (typeof input !== "string" || !input.trim()) throw new TypeError("Football-Data CSV is empty");
  const raw = parseCsv(input.replace(/^\uFEFF/, ""));
  if (raw.length < 2) throw new Error("Football-Data CSV must contain a header and match rows");
  const headers = raw[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim());
  const index = Object.fromEntries(headers.map((header, i) => [header.toLowerCase(), i]));
  const get = (row, ...names) => {
    for (const name of names) {
      const i = index[name.toLowerCase()];
      if (i !== undefined) return row[i] ?? "";
    }
    return "";
  };
  const div = String(options.division ?? get([], "Div") ?? "").trim().toUpperCase();
  const league = String(options.league ?? LEAGUES[div] ?? div).trim();
  const season = String(options.season ?? seasonFromCode(options.seasonCode ?? "")).trim();
  if (!league || !season) throw new Error("League and season are required; provide division/league and season/seasonCode");
  const matches = [], odds = [], errors = [];
  const bookmaker = String(options.bookmaker ?? "Bet365");
  const oddsSource = ({ Bet365: { prefix: "B365", closePrefix: "B365C" }, Pinnacle: { prefix: "PS", closePrefix: "PSC" }, "Market Average": { prefix: "Avg", closePrefix: "AvgC" } })[bookmaker];
  if (!oddsSource) throw new Error("bookmaker must be Bet365, Pinnacle, or Market Average");
  const seen = new Set();
  raw.slice(1).forEach((row, i) => {
    const line = i + 2;
    const date = dateToIso(get(row, "Date"));
    const homeTeam = get(row, "HomeTeam").trim();
    const awayTeam = get(row, "AwayTeam").trim();
    const homeGoals = numberInRange(get(row, "FTHG"), 0, 30);
    const awayGoals = numberInRange(get(row, "FTAG"), 0, 30);
    if (!date || !homeTeam || !awayTeam || homeTeam.toLocaleLowerCase() === awayTeam.toLocaleLowerCase() ||
        homeGoals === null || awayGoals === null) {
      errors.push({ row: line, message: "invalid date, team names, or full-time score; fixture excluded" });
      return;
    }
    const key = [date, league.toLocaleLowerCase(), season, homeTeam.toLocaleLowerCase(), awayTeam.toLocaleLowerCase()].join("|");
    if (seen.has(key)) {
      errors.push({ row: line, message: "duplicate fixture; duplicate excluded" });
      return;
    }
    seen.add(key);
    matches.push({ date, league, season, homeTeam, awayTeam, homeGoals, awayGoals });

    const prices = [
      ["home", validOdds(get(row, oddsSource.prefix + "H"))],
      ["draw", validOdds(get(row, oddsSource.prefix + "D"))],
      ["away", validOdds(get(row, oddsSource.prefix + "A"))]
    ];
    const closing = [
      validOdds(get(row, oddsSource.closePrefix + "H")),
      validOdds(get(row, oddsSource.closePrefix + "D")),
      validOdds(get(row, oddsSource.closePrefix + "A"))
    ];
    prices.forEach(([selection, price], j) => {
      if (price === null) return;
      odds.push({
        date, league, season, homeTeam, awayTeam, market: "1x2", selection,
        odds: price, closingOdds: closing[j], bookmaker,
        entryTimingQuality: "source_pre_match_time_not_provided",
        closingTimingQuality: closing[j] === null ? "missing" : "source_closing_time_not_provided"
      });
    });
  });
  const resultsCsv = [
    "date,league,season,home_team,away_team,home_goals,away_goals",
    ...matches.map(m => [m.date,m.league,m.season,m.homeTeam,m.awayTeam,m.homeGoals,m.awayGoals].map(csvCell).join(","))
  ].join("\n");
  const oddsCsv = [
    "date,league,home_team,away_team,market,selection,odds,closing_odds,bookmaker",
    ...odds.map(o => [o.date,o.league,o.homeTeam,o.awayTeam,o.market,o.selection,o.odds,o.closingOdds ?? "",o.bookmaker].map(csvCell).join(","))
  ].join("\n");
  return {
    matches, odds, errors, league, season,
    resultsCsv, oddsCsv,
    summary: {
      sourceRows: raw.length - 1, validMatches: matches.length, rejectedRows: errors.length,
      oddsQuotes: odds.length, matchesWithOdds: new Set(odds.map(o => [o.date,o.homeTeam,o.awayTeam].join("|"))).size,
      timestampedEntryQuotes: 0, timestampedClosingQuotes: 0
    }
  };
}
