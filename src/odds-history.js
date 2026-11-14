const REQUIRED = ["date", "home_team", "away_team", "market", "selection", "odds"];
const MARKETS = new Set(["1x2", "doubleChance", "totalGoals", "teamTotal", "handicap", "btts", "oddEven", "correctScore"]);

function parseRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
      continue;
    }
    if (afterQuote) {
      if (char === ",") { row.push(cell.trim()); cell = ""; afterQuote = false; }
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell.trim()); cell = ""; afterQuote = false;
        if (row.some(value => value !== "")) rows.push(row);
        row = [];
      } else if (char !== " " && char !== "\t") {
        throw new SyntaxError("unexpected character after a closing CSV quote");
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === ",") { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else if (char === '"') {
      throw new SyntaxError("unexpected quote inside an unquoted CSV field");
    } else cell += char;
  }
  if (quoted) throw new SyntaxError("CSV contains an unclosed quoted field");
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTimestamp(value, field) {
  if (!value) return null;
  const pattern = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;
  const match = value.match(pattern);
  if (!match || !validDate(match[1])) {
    throw new RangeError(field + " must be a valid ISO-8601 timestamp with timezone");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(field + " is invalid");
  return new Date(parsed).toISOString();
}

function descriptorFrom(row) {
  const { market, selection } = row;
  if (!MARKETS.has(market)) throw new RangeError("unsupported market: " + market);
  const descriptor = { type: market };
  const selections = {
    "1x2": ["home", "draw", "away"],
    doubleChance: ["homeDraw", "homeAway", "drawAway"],
    totalGoals: ["over", "under"],
    teamTotal: ["over", "under"],
    btts: ["yes", "no"],
    oddEven: ["odd", "even"]
  };
  if (selections[market]) {
    if (!selections[market].includes(selection)) {
      throw new RangeError("invalid " + market + " selection: " + selection);
    }
    descriptor.selection = selection;
  } else if (selection !== "") {
    throw new RangeError(market + " selection must be blank");
  }
  if (["totalGoals", "teamTotal", "handicap"].includes(market)) {
    if (row.line === "") throw new RangeError("market line is required");
    descriptor.line = Number(row.line);
    if (!Number.isFinite(descriptor.line) || Math.abs(descriptor.line) > 20 ||
        Math.abs(descriptor.line * 4 - Math.round(descriptor.line * 4)) > 1e-8) {
      throw new RangeError("market line must be a valid Asian quarter-line from -20 to 20");
    }
  }
  if (["teamTotal", "handicap"].includes(market)) {
    descriptor.team = row.team;
    if (!["home", "away"].includes(descriptor.team)) throw new RangeError("team must be home or away");
  }
  if (market === "correctScore") {
    if (row.home_goals === "" || row.away_goals === "") {
      throw new RangeError("correctScore requires both home_goals and away_goals");
    }
    descriptor.homeGoals = Number(row.home_goals);
    descriptor.awayGoals = Number(row.away_goals);
    if (!Number.isInteger(descriptor.homeGoals) || descriptor.homeGoals < 0 || descriptor.homeGoals > 30 ||
        !Number.isInteger(descriptor.awayGoals) || descriptor.awayGoals < 0 || descriptor.awayGoals > 30) {
      throw new RangeError("correctScore requires home_goals and away_goals from 0 to 30");
    }
  }
  return descriptor;
}

function duplicateKey(row) {
  return JSON.stringify([
    row.date, row.season, row.league, row.matchType, row.competitionType,
    row.homeTeam, row.awayTeam, row.neutralVenue, row.descriptor,
    row.bookmaker, row.source, row.oddsTimestampUtc
  ]);
}

/**
 * Parse historical market odds. Required: date,home_team,away_team,market,
 * selection,odds. Optional metadata: league,season,bookmaker,source,
 * match_type,competition_type,gender,age_category,confederation,neutral_venue,
 * kickoff_utc,odds_timestamp_utc,closing_odds_timestamp_utc.
 *
 * A closing price without a timestamp is retained as a raw price only;
 * consumers must not calculate timestamp-verified CLV from it.
 */
export function parseHistoricalOddsCsv(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty" }] };
  }
  let raw;
  try { raw = parseRows(input.replace(/^\uFEFF/, "")); }
  catch (error) { return { rows: [], errors: [{ row: 0, message: error.message }] }; }
  if (raw.length < 2) return { rows: [], errors: [{ row: 0, message: "CSV must include a header and at least one data row" }] };

  const headers = raw[0].map(value => value.trim().toLowerCase());
  if (headers.some(value => !value)) return { rows: [], errors: [{ row: 1, message: "header names must not be blank" }] };
  if (new Set(headers).size !== headers.length) return { rows: [], errors: [{ row: 1, message: "duplicate header names are not allowed" }] };
  const missing = REQUIRED.filter(name => !headers.includes(name));
  if (missing.length) return { rows: [], errors: [{ row: 1, message: "missing required columns: " + missing.join(", ") }] };

  const rows = [], errors = [], seen = new Set();
  raw.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      errors.push({ row: rowNumber, message: "column count does not match header" });
      return;
    }
    const record = Object.fromEntries(headers.map((name, i) => [name, values[i]]));
    try {
      if (!validDate(record.date)) throw new RangeError("date must use a valid YYYY-MM-DD value");
      if (!record.home_team || !record.away_team || record.home_team === record.away_team) {
        throw new RangeError("home_team and away_team must be different non-empty names");
      }
      const odds = Number(record.odds);
      if (record.odds === "" || !Number.isFinite(odds) || odds <= 1) {
        throw new RangeError("odds must be decimal odds greater than 1");
      }
      const closingOdds = record.closing_odds === undefined || record.closing_odds === "" ? null : Number(record.closing_odds);
      if (closingOdds !== null && (!Number.isFinite(closingOdds) || closingOdds <= 1)) {
        throw new RangeError("closing_odds must be blank or decimal odds greater than 1");
      }

      const kickoffUtc = parseTimestamp(record.kickoff_utc, "kickoff_utc");
      const oddsTimestampUtc = parseTimestamp(record.odds_timestamp_utc, "odds_timestamp_utc");
      const closingOddsTimestampUtc = parseTimestamp(record.closing_odds_timestamp_utc, "closing_odds_timestamp_utc");
      if ((oddsTimestampUtc || closingOddsTimestampUtc) && !kickoffUtc) {
        throw new RangeError("kickoff_utc is required when odds timestamps are supplied");
      }
      if (oddsTimestampUtc && Date.parse(oddsTimestampUtc) >= Date.parse(kickoffUtc)) {
        throw new RangeError("entry odds timestamp must be before kickoff");
      }
      if (closingOddsTimestampUtc && closingOdds === null) {
        throw new RangeError("closing_odds is required when closing_odds_timestamp_utc is supplied");
      }
      if (closingOddsTimestampUtc && (!oddsTimestampUtc ||
          Date.parse(closingOddsTimestampUtc) < Date.parse(oddsTimestampUtc) ||
          Date.parse(closingOddsTimestampUtc) >= Date.parse(kickoffUtc))) {
        throw new RangeError("closing odds timestamp must be between entry timestamp and before kickoff");
      }

      const matchType = record.match_type || "club";
      if (!["club", "national_team"].includes(matchType)) throw new RangeError("match_type must be club or national_team");
      const neutralRaw = (record.neutral_venue || "").toLowerCase();
      if (neutralRaw && !["true", "false", "1", "0", "yes", "no"].includes(neutralRaw)) {
        throw new RangeError("neutral_venue must be a boolean value");
      }
      const neutralVenue = neutralRaw ? ["true", "1", "yes"].includes(neutralRaw) : null;
      const row = {
        date: record.date, season: record.season || "", league: record.league || "",
        homeTeam: record.home_team, awayTeam: record.away_team,
        matchType, competitionType: record.competition_type || "",
        gender: record.gender || "", ageCategory: record.age_category || "",
        confederation: record.confederation || "", neutralVenue,
        bookmaker: record.bookmaker || "", source: record.source || "",
        sourceMatchId: record.source_match_id || "",
        descriptor: descriptorFrom(record), odds, closingOdds,
        kickoffUtc, oddsTimestampUtc, closingOddsTimestampUtc,
        clvTimingVerified: Boolean(closingOdds !== null && kickoffUtc && oddsTimestampUtc && closingOddsTimestampUtc)
      };
      const key = duplicateKey(row);
      if (seen.has(key)) throw new RangeError("duplicate fixture-market-bookmaker-timestamp row");
      seen.add(key);
      rows.push(row);
    } catch (error) {
      errors.push({ row: rowNumber, message: error.message });
    }
  });
  return { rows, errors };
}
