const REQUIRED = ["date", "home_team", "away_team", "market", "selection", "odds"];
const MARKETS = new Set(["1x2", "doubleChance", "totalGoals", "teamTotal", "handicap", "btts", "oddEven", "correctScore"]);

function parseRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
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

function descriptorFrom(row) {
  const { market, selection } = row;
  if (!MARKETS.has(market)) throw new RangeError("unsupported market: " + market);
  const descriptor = { type: market };
  if (["1x2", "doubleChance", "totalGoals", "teamTotal", "btts", "oddEven"].includes(market)) descriptor.selection = selection;
  if (["totalGoals", "teamTotal", "handicap"].includes(market)) {
    descriptor.line = Number(row.line);
    if (!Number.isFinite(descriptor.line)) throw new RangeError("market line is required and must be numeric");
  }
  if (["teamTotal", "handicap"].includes(market)) {
    descriptor.team = row.team;
    if (!["home", "away"].includes(descriptor.team)) throw new RangeError("team must be home or away");
  }
  if (market === "correctScore") {
    descriptor.homeGoals = Number(row.home_goals);
    descriptor.awayGoals = Number(row.away_goals);
    if (!Number.isInteger(descriptor.homeGoals) || descriptor.homeGoals < 0 ||
        !Number.isInteger(descriptor.awayGoals) || descriptor.awayGoals < 0) {
      throw new RangeError("correctScore requires home_goals and away_goals");
    }
  }
  return descriptor;
}

/**
 * Parse historical market odds. Required: date,home_team,away_team,market,
 * selection,odds. Optional: league,line,team,home_goals,away_goals,closing_odds.
 */
export function parseHistoricalOddsCsv(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty" }] };
  }
  let raw;
  try { raw = parseRows(input.replace(/^\uFEFF/, "")); }
  catch (error) { return { rows: [], errors: [{ row: 0, message: error.message }] }; }
  if (raw.length < 2) return { rows: [], errors: [{ row: 0, message: "CSV must include a header and at least one data row" }] };
  const headers = raw[0].map(value => value.toLowerCase());
  const missing = REQUIRED.filter(name => !headers.includes(name));
  if (missing.length) return { rows: [], errors: [{ row: 1, message: "missing required columns: " + missing.join(", ") }] };
  const rows = [], errors = [];
  raw.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      errors.push({ row: rowNumber, message: "column count does not match header" });
      return;
    }
    const record = Object.fromEntries(headers.map((name, i) => [name, values[i]]));
    try {
      if (!validDate(record.date)) throw new RangeError("date must use a valid YYYY-MM-DD value");
      if (!record.home_team || !record.away_team || record.home_team === record.away_team) throw new RangeError("home_team and away_team must be different non-empty names");
      const odds = Number(record.odds);
      if (!Number.isFinite(odds) || odds <= 1) throw new RangeError("odds must be decimal odds greater than 1");
      const closingOdds = record.closing_odds === undefined || record.closing_odds === "" ? null : Number(record.closing_odds);
      if (closingOdds !== null && (!Number.isFinite(closingOdds) || closingOdds <= 1)) throw new RangeError("closing_odds must be blank or decimal odds greater than 1");
      rows.push({
        date: record.date, league: record.league || "",
        homeTeam: record.home_team, awayTeam: record.away_team,
        descriptor: descriptorFrom(record), odds, closingOdds
      });
    } catch (error) {
      errors.push({ row: rowNumber, message: error.message });
    }
  });
  return { rows, errors };
}
