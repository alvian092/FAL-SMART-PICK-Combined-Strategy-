import { scoreMatrix, matchProbabilities, fairOdds, expectedValue, estimateLambdas } from "./engine.js";
import { parseHistoricalCsv, getHistoricalLeagues, getHistoricalTeams, getHeadToHead } from "./historical.js";
import "./styles.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <header class="topbar">
    <div class="brand-mark">FAL</div>
    <div><strong>SMART PICK</strong><small>COMBINED STRATEGY · FOUNDATION</small></div>
    <span class="status">ENGINE LOCAL</span>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">FOOTBALL ANALYTICS LAB</p>
      <h1>Find the value.<br><span>Respect the probability.</span></h1>
      <p class="muted">Analisis probabilitas pertandingan. Data historis hanya berasal dari CSV yang kamu unggah; belum ada odds API atau data pertandingan otomatis.</p>
    </section>
    <section class="panel history-panel">
      <div class="section-heading"><div><p class="eyebrow">HISTORICAL DATA</p><h2>Import database CSV</h2></div><span class="tag">LOCAL IMPORT</span></div>
      <p class="muted compact">Format wajib: date, league, season, home_team, away_team, home_goals, away_goals. Tanggal YYYY-MM-DD, skor 0–30. Data tersimpan lokal di perangkat ini.</p>
      <label class="file-label">Pilih file CSV<input id="csv-file" type="file" accept=".csv,text/csv"></label>
      <p id="import-status" class="import-status" role="status">Belum ada data historis yang diimpor.</p>
      <div id="import-summary" class="import-summary" hidden></div>
      <div id="import-errors" class="import-errors" hidden></div>
      <div class="selector-grid">
        <label>Liga<select id="league-select" disabled><option value="">Impor CSV terlebih dahulu</option></select></label>
        <label>Tim kandang<select id="home-select" disabled><option value="">Pilih liga dahulu</option></select></label>
        <label>Tim tandang<select id="away-select" disabled><option value="">Pilih liga dahulu</option></select></label>
      </div>
      <button id="use-teams" class="secondary" disabled>Gunakan pilihan tim</button>
      <div id="h2h-output" class="h2h-output"></div>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">01 / MATCH MODEL</p><h2>Input pertandingan</h2></div><span class="tag">PRE-MATCH</span></div>
      <div class="fields">
        <label>Tim kandang<input id="home" value="Home Team" maxlength="60"></label>
        <label>Tim tandang<input id="away" value="Away Team" maxlength="60"></label>
        <label>Lambda kandang<input id="lh" type="number" min="0" max="8" step="0.01" value="1.55"></label>
        <label>Lambda tandang<input id="la" type="number" min="0" max="8" step="0.01" value="1.10"></label>
        <label>Tanggal analisis<input id="analysis-date" type="date"></label>
      </div>
      <button id="estimate-lambda" class="secondary">Hitung lambda otomatis · 20 laga</button>
      <p id="lambda-status" class="import-status" role="status">Pilih tim dan impor riwayat pertandingan untuk menghitung lambda otomatis.</p>
      <button id="analyze" class="primary">Hitung probabilitas</button>
      <p id="error" class="error" role="alert"></p>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">02 / MODEL OUTPUT</p><h2 id="match-title">Home Team vs Away Team</h2></div><span class="tag">POISSON BASELINE</span></div>
      <div id="probabilities" class="metric-grid"></div>
      <p class="notice">Lambda dapat dihitung dari maksimal 20 penampilan terakhir setiap tim di semua kompetisi yang diimpor, hanya memakai pertandingan sebelum tanggal analisis. Kamu tetap bisa mengubah lambda secara manual.</p>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">03 / VALUE CHECK</p><h2>Evaluasi odds 1X2</h2></div><span class="tag">MANUAL ODDS</span></div>
      <div class="fields odds-fields">
        <label>Odds Home<input id="oh" type="number" min="1.01" step="0.01" value="2.10"></label>
        <label>Odds Draw<input id="od" type="number" min="1.01" step="0.01" value="3.30"></label>
        <label>Odds Away<input id="oa" type="number" min="1.01" step="0.01" value="3.60"></label>
      </div>
      <div id="value-output" class="value-output"></div>
      <p class="notice">EV adalah estimasi matematis, bukan jaminan hasil. Periksa kualitas data, margin, dan ketidakpastian model sebelum mengambil keputusan.</p>
    </section>
    <section class="panel roadmap">
      <p class="eyebrow">DEVELOPMENT ROADMAP</p>
      <h2>Build in verified stages</h2>
      <ul>
        <li class="done">Foundation · Poisson probability · manual odds</li>
        <li class="done">Historical CSV import · validation · league/team selector · H2H</li>
        <li class="done">Automatic lambda · last 20 appearances · venue and opponent adjustment</li>
        <li>Dixon-Coles · Elo · calibration</li>
        <li>All markets · fair odds · EV · Kelly</li>
        <li>Smart Pick ranking · walk-forward backtest</li>
        <li>Live model · Android APK release</li>
      </ul>
    </section>
    <footer>FAL SMART PICK · Educational analytics · No guaranteed outcomes</footer>
  </main>
`;

const $ = (id) => document.getElementById(id);
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const num = (value) => Number(value).toFixed(2);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

let historicalMatches = [];
let importErrors = [];

try {
  const saved = JSON.parse(localStorage.getItem("fal-historical-matches") || "[]");
  if (Array.isArray(saved)) historicalMatches = saved.filter((match) =>
    match && typeof match.date === "string" && typeof match.league === "string" &&
    typeof match.homeTeam === "string" && typeof match.awayTeam === "string" &&
    Number.isInteger(match.homeGoals) && Number.isInteger(match.awayGoals)
  );
} catch {
  historicalMatches = [];
}

function setOptions(select, values, placeholder, selected = "") {
  select.replaceChildren();
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.append(first);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  if (values.includes(selected)) select.value = selected;
}

function updateTeamSelectors() {
  const league = $("league-select").value;
  const home = $("home-select").value;
  const away = $("away-select").value;
  const leagues = getHistoricalLeagues(historicalMatches);
  setOptions($("league-select"), leagues, leagues.length ? "Pilih liga" : "Impor CSV terlebih dahulu", league);
  const teams = getHistoricalTeams(historicalMatches, $("league-select").value);
  setOptions($("home-select"), teams, teams.length ? "Pilih tim kandang" : "Pilih liga dahulu", home);
  setOptions($("away-select"), teams, teams.length ? "Pilih tim tandang" : "Pilih liga dahulu", away);
  $("league-select").disabled = leagues.length === 0;
  $("home-select").disabled = teams.length === 0;
  $("away-select").disabled = teams.length === 0;
  $("use-teams").disabled = teams.length === 0;
  renderH2H();
}

function renderH2H() {
  const league = $("league-select").value;
  const home = $("home-select").value;
  const away = $("away-select").value;
  const matches = getHeadToHead(historicalMatches, home, away, league);
  const output = $("h2h-output");
  if (!home || !away || home === away) {
    output.textContent = "Pilih dua tim berbeda untuk melihat riwayat H2H dari data yang diimpor.";
    return;
  }
  if (!matches.length) {
    output.textContent = "Belum ada catatan H2H untuk pasangan tim ini pada liga yang dipilih.";
    return;
  }
  output.innerHTML = `<strong>H2H · ${matches.length} pertandingan</strong>` + matches.slice(0, 8).map((match) =>
    `<div class="h2h-row"><span>${escapeHtml(match.date)}</span><strong>${escapeHtml(match.homeTeam)} ${match.homeGoals}–${match.awayGoals} ${escapeHtml(match.awayTeam)}</strong><small>${escapeHtml(match.season)}</small></div>`
  ).join("") + (matches.length > 8 ? `<small class="muted">Menampilkan 8 dari ${matches.length} pertandingan.</small>` : "");
}

function showImportSummary(totalRows, validRows, errors) {
  $("import-summary").hidden = false;
  $("import-summary").textContent = `${validRows} valid · ${errors} ditolak · ${totalRows} total baris`;
}

$("csv-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("import-status").textContent = `Membaca ${file.name}…`;
  $("import-errors").hidden = true;
  try {
    const result = parseHistoricalCsv(await file.text());
    importErrors = result.errors;
    showImportSummary(result.totalRows, result.matches.length, result.errors.length);
    if (importErrors.length) {
      $("import-errors").hidden = false;
      $("import-errors").innerHTML = "<strong>Baris yang ditolak</strong>" + importErrors.slice(0, 8).map((item) =>
        `<p>Baris ${item.line}: ${escapeHtml(item.message)}</p>`
      ).join("") + (importErrors.length > 8 ? `<p>Dan ${importErrors.length - 8} kesalahan lainnya.</p>` : "");
    }
    if (!result.matches.length) {
      $("import-status").textContent = `Tidak ada baris valid di ${file.name}; data historis sebelumnya tidak diubah.`;
      return;
    }
    historicalMatches = result.matches;
    localStorage.setItem("fal-historical-matches", JSON.stringify(historicalMatches));
    $("import-status").textContent = `Berhasil mengimpor ${result.matches.length} pertandingan dari ${file.name}.`;
    updateTeamSelectors();
  } catch (error) {
    $("import-status").textContent = error.message;
    $("import-summary").hidden = true;
    $("import-errors").hidden = true;
  }
});

$("league-select").addEventListener("change", () => {
  setOptions($("home-select"), getHistoricalTeams(historicalMatches, $("league-select").value), "Pilih tim kandang");
  setOptions($("away-select"), getHistoricalTeams(historicalMatches, $("league-select").value), "Pilih tim tandang");
  $("home-select").disabled = false;
  $("away-select").disabled = false;
  renderH2H();
});
$("home-select").addEventListener("change", renderH2H);
$("away-select").addEventListener("change", renderH2H);
$("use-teams").addEventListener("click", () => {
  const home = $("home-select").value;
  const away = $("away-select").value;
  if (!home || !away || home === away) {
    $("import-status").textContent = "Pilih dua tim yang berbeda terlebih dahulu.";
    return;
  }
  $("home").value = home;
  $("away").value = away;
  $("import-status").textContent = `Pilihan diterapkan: ${home} vs ${away}. Lambda masih perlu dihitung/diisi terpisah.`;
  render();
});


function setDefaultAnalysisDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("analysis-date").value = localDate;
}

$("estimate-lambda").addEventListener("click", () => {
  const home = $("home").value.trim();
  const away = $("away").value.trim();
  const cutoffDate = $("analysis-date").value;
  try {
    if (!historicalMatches.length) throw new Error("Impor CSV historis terlebih dahulu.");
    if (!home || !away || home === away) throw new Error("Pilih dua tim yang berbeda.");
    if (!cutoffDate) throw new Error("Isi tanggal analisis terlebih dahulu.");
    const estimate = estimateLambdas(historicalMatches, home, away, {
      limit: 20,
      recencyDecay: 0.95,
      priorMatches: 5,
      cutoffDate
    });
    $("lh").value = estimate.lambdaHome.toFixed(2);
    $("la").value = estimate.lambdaAway.toFixed(2);
    const warnings = [];
    if (estimate.home.appearances < 10 || estimate.away.appearances < 10) {
      warnings.push("Sampel kurang dari 10 laga untuk setidaknya satu tim; estimasi lebih tidak pasti.");
    }
    if (estimate.usedFallbackBaseline) warnings.push("Rata-rata gol historis nol; baseline default dipakai.");
    if (estimate.clamped) warnings.push("Lambda dibatasi pada rentang 0–8.");
    $("lambda-status").textContent =
      `Lambda otomatis berhasil · ${home}: ${estimate.home.appearances} laga (${estimate.home.oldestDate}–${estimate.home.newestDate}) · ${away}: ${estimate.away.appearances} laga (${estimate.away.oldestDate}–${estimate.away.newestDate}) · semua kompetisi, sebelum ${cutoffDate}. Baseline kandang/tandang: ${estimate.baselineHome.toFixed(2)} / ${estimate.baselineAway.toFixed(2)} gol. ${warnings.join(" ")}`;
    render();
  } catch (error) {
    $("lambda-status").textContent = error.message;
  }
});

function render() {
  try {
    $("error").textContent = "";
    const lh = Number($("lh").value);
    const la = Number($("la").value);
    const matrix = scoreMatrix(lh, la, 12);
    const p = matchProbabilities(matrix);
    const home = $("home").value.trim() || "Home";
    const away = $("away").value.trim() || "Away";
    $("match-title").textContent = `${home} vs ${away}`;
    $("probabilities").innerHTML = [
      ["HOME", p.home], ["DRAW", p.draw], ["AWAY", p.away],
      ["OVER 2.5", p.over25], ["UNDER 2.5", p.under25], ["BTTS YES", p.bttsYes]
    ].map(([label, value]) => `<article class="metric"><small>${label}</small><strong>${pct(value)}</strong><span>Fair ${num(fairOdds(value))}</span></article>`).join("");
    const odds = [Number($("oh").value), Number($("od").value), Number($("oa").value)];
    const values = [p.home, p.draw, p.away];
    const labels = [home, "Draw", away];
    $("value-output").innerHTML = odds.map((odd, i) => {
      if (!Number.isFinite(odd) || odd <= 1) return "";
      const ev = expectedValue(values[i], odd);
      return `<div class="value-row"><span>${escapeHtml(labels[i])}</span><strong>${ev >= 0 ? "+" : ""}${pct(ev)}</strong><small>Model ${pct(values[i])} · Fair ${num(fairOdds(values[i]))} · Odds ${num(odd)}</small></div>`;
    }).join("");
  } catch (error) {
    $("error").textContent = error.message;
  }
}
$("analyze").addEventListener("click", render);
["home","away","lh","la","oh","od","oa"].forEach((id) => $(id).addEventListener("change", render));
setDefaultAnalysisDate();
updateTeamSelectors();
if (historicalMatches.length) {
  $("import-status").textContent = `Memuat ${historicalMatches.length} pertandingan historis tersimpan di perangkat ini.`;
  showImportSummary(historicalMatches.length, historicalMatches.length, 0);
}
render();
