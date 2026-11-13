const REQUIRED_HEADERS = ["date", "league", "season", "home_team", "away_team", "home_goals", "away_goals"];

function parseRecords(csv) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
        if (char === "\n") line += 1;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\r" && char !== "\n" && char !== " " && char !== "\t") {
      throw new Error(`CSV tidak valid pada baris ${line}: karakter setelah tanda kutip.`);
    }
    if (char === '"' && field.length === 0 && !afterQuote) {
      quoted = true;
    } else if (char === "," ) {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) records.push({ values: row, line: recordLine });
      row = [];
      field = "";
      afterQuote = false;
      line += 1;
      recordLine = line;
    } else {
      field += char;
      afterQuote = false;
    }
  }
  if (quoted) throw new Error(`CSV tidak valid: tanda kutip tidak ditutup (mulai baris ${recordLine}).`);
  row.push(field);
  if (row.some((value) => value.trim() !== "")) records.push({ values: row, line: recordLine });
  return records;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Parse and validate the FAL historical match CSV format.
 * Invalid rows are reported and excluded; valid rows are never silently modified.
 */
export function parseHistoricalCsv(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new TypeError("File CSV kosong atau tidak terbaca.");
  }
  const records = parseRecords(input.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new Error("CSV harus berisi header dan minimal satu baris pertandingan.");

  const headers = records[0].values.map((value) => value.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(", ")}.`);
  if (new Set(headers).size !== headers.length) throw new Error("Header CSV mengandung nama kolom duplikat.");

  const index = Object.fromEntries(REQUIRED_HEADERS.map((header) => [header, headers.indexOf(header)]));
  const matches = [];
  const errors = [];
  const seen = new Set();

  for (const record of records.slice(1)) {
    const values = record.values;
    const get = (key) => (values[index[key]] ?? "").trim();
    const date = get("date");
    const league = get("league");
    const season = get("season");
    const homeTeam = get("home_team");
    const awayTeam = get("away_team");
    const homeGoalsText = get("home_goals");
    const awayGoalsText = get("away_goals");
    const issues = [];

    if (!validDate(date)) issues.push("date harus valid dengan format YYYY-MM-DD");
    if (!league) issues.push("league wajib diisi");
    if (!season) issues.push("season wajib diisi");
    if (!homeTeam) issues.push("home_team wajib diisi");
    if (!awayTeam) issues.push("away_team wajib diisi");
    if (homeTeam && awayTeam && homeTeam.toLocaleLowerCase() === awayTeam.toLocaleLowerCase()) {
      issues.push("tim kandang dan tandang tidak boleh sama");
    }
    const homeGoals = Number(homeGoalsText);
    const awayGoals = Number(awayGoalsText);
    if (!/^\d+$/.test(homeGoalsText) || !Number.isSafeInteger(homeGoals) || homeGoals > 30) {
      issues.push("home_goals harus bilangan bulat 0–30");
    }
    if (!/^\d+$/.test(awayGoalsText) || !Number.isSafeInteger(awayGoals) || awayGoals > 30) {
      issues.push("away_goals harus bilangan bulat 0–30");
    }
    if (values.length !== headers.length) issues.push("jumlah kolom tidak sesuai header");

    const key = [date, league.toLocaleLowerCase(), season.toLocaleLowerCase(),
      homeTeam.toLocaleLowerCase(), awayTeam.toLocaleLowerCase()].join("|");
    if (!issues.length && seen.has(key)) issues.push("pertandingan duplikat");
    if (issues.length) {
      errors.push({ line: record.line, message: issues.join("; ") });
      continue;
    }
    seen.add(key);
    matches.push({ date, league, season, homeTeam, awayTeam, homeGoals, awayGoals });
  }

  if (!matches.length) throw new Error(`Tidak ada baris valid. ${errors.length} baris ditolak.`);
  return { matches, errors, totalRows: records.length - 1 };
}

export function getHistoricalLeagues(matches) {
  return [...new Set(matches.map((match) => match.league))].sort((a, b) => a.localeCompare(b));
}

export function getHistoricalTeams(matches, league) {
  const selected = matches.filter((match) => match.league === league);
  return [...new Set(selected.flatMap((match) => [match.homeTeam, match.awayTeam]))]
    .sort((a, b) => a.localeCompare(b));
}

/** H2H is a view over the imported match list; it does not append duplicate records. */
export function getHeadToHead(matches, teamA, teamB, league = "") {
  if (!teamA || !teamB || teamA === teamB) return [];
  return matches
    .filter((match) => (!league || match.league === league) &&
      ((match.homeTeam === teamA && match.awayTeam === teamB) ||
       (match.homeTeam === teamB && match.awayTeam === teamA)))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
}
