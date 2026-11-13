import { dixonColesScoreMatrix, matchProbabilities, fairOdds, expectedValue, estimateLambdas, estimateElo, walkForwardBacktest, estimateProbabilityIntervals, walkForwardPredictiveIntervalBacktest } from "./engine.js";
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
        <label>Dixon-Coles rho<input id="rho" type="number" min="-1" max="1" step="0.01" value="-0.08"></label>
        <label>Tanggal analisis<input id="analysis-date" type="date"></label>
      </div>
      <button id="estimate-lambda" class="secondary">Hitung lambda otomatis · 20 laga</button>
      <button id="estimate-uncertainty" class="secondary">Hitung uncertainty intervals · bootstrap</button>
      <div id="uncertainty-output" class="uncertainty-output" aria-live="polite"></div>
      <p id="lambda-status" class="import-status" role="status">Pilih tim dan impor riwayat pertandingan untuk menghitung lambda otomatis.</p>
      <button id="analyze" class="primary">Hitung probabilitas</button>
      <p id="error" class="error" role="alert"></p>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">02 / MODEL OUTPUT</p><h2 id="match-title">Home Team vs Away Team</h2></div><span class="tag">POISSON + DIXON-COLES</span></div>
      <div id="probabilities" class="metric-grid"></div>
      <div id="elo-output" class="elo-output" aria-live="polite"></div>
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
    <section class="panel backtest-panel">\n      <div class="section-heading"><div><p class="eyebrow">04 / MODEL VALIDATION</p><h2>Walk-forward backtest</h2></div><span class="tag">TIME ORDERED</span></div>\n      <p class="muted compact">Uji prediksi historis secara kronologis. Setiap pertandingan hanya diprediksi memakai data dari tanggal sebelumnya; kalibrasi hanya memakai prediksi out-of-sample yang lebih lama. Pertandingan yang datanya belum cukup akan dilewati dan dilaporkan.</p>\n      <button id="run-backtest" class="secondary">Jalankan walk-forward backtest</button>
      <button id="run-interval-backtest" class="secondary">Uji coverage uncertainty intervals</button>
      <p id="interval-backtest-status" class="import-status" role="status">Uji rentang skor prediktif terhadap hasil historis out-of-sample.</p>
      <div id="interval-backtest-output" class="backtest-output"></div>\n      <p id="backtest-status" class="import-status" role="status">Impor database CSV untuk mengevaluasi model.</p>\n      <div id="backtest-output" class="backtest-output"></div>\n    </section>\n    <section class="panel roadmap">
      <p class="eyebrow">DEVELOPMENT ROADMAP</p>
      <h2>Build in verified stages</h2>
      <ul>
        <li class="done">Foundation · Poisson probability · manual odds</li>
        <li class="done">Historical CSV import · validation · league/team selector · H2H</li>
        <li class="done">Automatic lambda · last 20 appearances · venue and opponent adjustment</li>
        <li class="done">Dixon-Coles low-score correction · chronological Elo ratings</li>
        <li class="done">Temperature calibration · log-loss diagnostics</li>\n        <li class="done">Expanding walk-forward backtest · Brier score · log loss · accuracy</li>\n        <li class="done">Reliability diagrams · calibration bins · per-league diagnostics</li>
        <li>Uncertainty intervals · posterior-predictive score ranges · walk-forward coverage validation</li>
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

function syncSelectedTeams() {
  const home = $("home-select").value;
  const away = $("away-select").value;
  if (!home || !away) {
    $("lambda-status").textContent = "Pilih liga, lalu pilih tim kandang dan tim tandang. Setelah keduanya dipilih, Match Model akan terisi otomatis.";
    return;
  }
  if (home === away) {
    $("lambda-status").textContent = "Tim kandang dan tandang harus berbeda.";
    return;
  }
  $("home").value = home;
  $("away").value = away;
  $("import-status").textContent = `Pilihan otomatis diterapkan: ${home} vs ${away}.`;
  $("lambda-status").textContent = "Pasangan tim sudah tersambung ke Match Model. Hitung lambda otomatis untuk memakai riwayat masing-masing tim.";
  render();
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
  $("home").value = "";
  $("away").value = "";
  $("lambda-status").textContent = "Liga berubah. Pilih ulang tim kandang dan tandang.";
  $("home-select").disabled = false;
  $("away-select").disabled = false;
  renderH2H();
});
$("home-select").addEventListener("change", () => { renderH2H(); syncSelectedTeams(); });
$("away-select").addEventListener("change", () => { renderH2H(); syncSelectedTeams(); });
$("use-teams").addEventListener("click", () => {
  const home = $("home-select").value;
  const away = $("away-select").value;
  if (!home || !away || home === away) {
    $("import-status").textContent = "Pilih dua tim yang berbeda terlebih dahulu.";
    return;
  }
  $("home").value = home;
  $("away").value = away;
  $("import-status").textContent = `Pilihan diterapkan: ${home} vs ${away}. Tekan Hitung lambda otomatis untuk menghitung dari riwayat 20 laga.`;
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



$("estimate-uncertainty").addEventListener("click", () => {
  const button = $("estimate-uncertainty");
  const home = $("home").value.trim(), away = $("away").value.trim(), cutoffDate = $("analysis-date").value;
  button.disabled = true;
  $("uncertainty-output").textContent = "Menghitung bootstrap dari data historis sebelum tanggal analisis…";
  try {
    if (!historicalMatches.length) throw new Error("Impor CSV historis terlebih dahulu.");
    if (!cutoffDate) throw new Error("Isi tanggal analisis terlebih dahulu.");
    const result = estimateProbabilityIntervals(historicalMatches, home, away, { cutoffDate, rho: Number($("rho").value), iterations: 200, confidenceLevel: 0.9 });
    const labels = { home: "Home win", draw: "Draw", away: "Away win", over25: "Over 2.5", bttsYes: "BTTS Yes", lambdaHome: "Lambda Home", lambdaAway: "Lambda Away" };
    $("uncertainty-output").innerHTML = `<div class="backtest-group"><strong>90% bootstrap uncertainty interval</strong>
      <p class="notice">200 resampling dari fixture sebelum ${escapeHtml(cutoffDate)}. Ini mengukur sensitivitas model terhadap sampel historis, bukan peluang hasil atau jaminan rentang skor.</p>
      <div class="uncertainty-grid">${Object.entries(result.intervals).map(([key, x]) => { const fmt = key.startsWith("lambda") ? num : pct; return `<article class="uncertainty-card"><small>${labels[key]}</small><strong>${fmt(x.median)}</strong><span>${fmt(x.lower)} – ${fmt(x.upper)}</span></article>`; }).join("")}</div>
      <p class="notice">Data historis: ${result.sampleSize} · bootstrap berhasil: ${result.successfulIterations}/${result.iterations} · gagal: ${result.failedIterations}. Input sama menghasilkan hasil yang sama.</p></div>`;
  } catch (error) { $("uncertainty-output").textContent = error.message; }
  finally { button.disabled = false; }
});


$("run-interval-backtest").addEventListener("click", () => {
  const button = $("run-interval-backtest");
  button.disabled = true;
  $("interval-backtest-status").textContent = "Menguji interval prediktif secara kronologis; proses bisa lebih lama untuk database besar…";
  $("interval-backtest-output").replaceChildren();
  try {
    if (!historicalMatches.length) throw new Error("Impor CSV historis terlebih dahulu.");
    const minTrainingMatches = Math.min(30, Math.max(10, Math.floor(historicalMatches.length * 0.5)));
    const result = walkForwardPredictiveIntervalBacktest(historicalMatches, {
      minTrainingMatches, minTeamAppearances: 5, calibrationMinSamples: 20,
      intervalIterations: 50, confidenceLevel: 0.9, rho: Number($("rho").value)
    });
    const rows = Object.entries(result.coverage).map(([key, item]) => {
      const label = ({ homeGoals: "Gol kandang", awayGoals: "Gol tandang",
        totalGoals: "Total gol", goalDifference: "Selisih gol" })[key];
      return "<div class=\\"reliability-row\\"><span>" + label + "</span><span>" +
        (item.empiricalCoverage === null ? "—" : pct(item.empiricalCoverage)) +
        "</span><span>" + item.covered + "/" + item.sampleSize + "</span><span>" +
        (item.meanWidth === null ? "—" : item.meanWidth.toFixed(2)) + "</span></div>";
    }).join("");
    $("interval-backtest-status").textContent =
      "Selesai · " + result.evaluated + " interval diuji · " + result.skippedCount +
      " prediksi dilewati karena riwayat belum cukup.";
    $("interval-backtest-output").innerHTML =
      "<div class=\\"backtest-group\\"><strong>Empirical predictive-interval coverage · nominal " +
      pct(result.confidenceLevel) + "</strong>" +
      "<p class=\\"notice\\">Coverage adalah proporsi skor aktual yang jatuh di dalam rentang prediktif out-of-sample. " +
      "Ini berbeda dari interval probabilitas dan bukan jaminan bahwa coverage masa depan akan sama. " +
      "Nilai sampel kecil masih tidak stabil.</p><div class=\\"reliability-table\\">" +
      "<div class=\\"reliability-row reliability-head\\"><span>Target</span><span>Coverage</span>" +
      "<span>Tercakup/n</span><span>Lebar rata-rata</span></div>" + rows + "</div>" +
      "<p class=\\"notice\\">Bootstrap per fixture: " + result.iterations +
      " iterasi · hanya pertandingan sebelum tanggal target · hasil aktual diuji pada gol kandang, " +
      "gol tandang, total gol, dan selisih gol.</p></div>";
  } catch (error) {
    $("interval-backtest-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("run-backtest").addEventListener("click", () => {
  const button = $("run-backtest");
  button.disabled = true;
  $("backtest-status").textContent = "Menjalankan pengujian kronologis…";
  $("backtest-output").replaceChildren();
  try {
    if (!historicalMatches.length) throw new Error("Impor CSV historis terlebih dahulu.");
    const minTrainingMatches = Math.min(30, Math.max(10, Math.floor(historicalMatches.length * 0.5)));
    const result = walkForwardBacktest(historicalMatches, {
      minTrainingMatches,
      minTeamAppearances: 5,
      calibrationMinSamples: 20,
      rho: Number($("rho").value)
    });
    const metric = (value) => value === null ? "—" : value.toFixed(4);
    const percent = (value) => value === null ? "—" : pct(value);
    const raw = result.rawMetrics;
    const calibrated = result.calibratedMetrics;
    const calibratedOnly = result.calibrationMetrics;
    $("backtest-status").textContent =
      `Selesai · ${result.evaluated} prediksi out-of-sample · ${result.skippedCount} dilewati · ${result.totalValidFixtures} pertandingan valid. ` +
      (result.calibrationSamples ? `${result.calibrationSamples} prediksi memakai calibrator yang dilatih dari prediksi sebelumnya.` :
        "Belum cukup prediksi terdahulu untuk mengaktifkan kalibrasi; hasil tetap memakai probabilitas mentah.") +
      ` Warm-up minimum: ${minTrainingMatches} pertandingan; minimal 5 penampilan per tim; kalibrasi membutuhkan 20 prediksi terdahulu. Sampel kecil bersifat eksploratif.`;
    const cards = (title, data) => data ? `
      <div class="backtest-group"><strong>${title} · n=${data.sampleSize}</strong>
        <div class="backtest-metrics">
          <span>Log loss<b>${metric(data.logLoss)}</b></span>
          <span>Brier score<b>${metric(data.brierScore)}</b></span>
          <span>Accuracy<b>${percent(data.accuracy)}</b></span>
        </div>
      </div>` : "";
    $("backtest-output").innerHTML =
      cards("Raw model · semua prediksi", raw) +
      cards("Walk-forward calibrated · termasuk masa warm-up", calibrated) +
      cards("Calibrated-only · sesudah warm-up", calibratedOnly) +
      `` +
      `<p class="notice">Log loss dan Brier score lebih rendah lebih baik; accuracy bukan ukuran kalibrasi. Data yang dilewati tidak dihitung sebagai prediksi. Ini evaluasi historis, bukan jaminan performa masa depan.</p>`;

    const formatBin = (value) => value === null ? "—" : pct(value);
    const reliability = (title, data) => {
      const bins = data.bins;
      const rows = bins.map((bin) => `
        <div class="reliability-row">
          <span>${Math.round(bin.lower * 100)}–${Math.round(bin.upper * 100)}%</span>
          <span>${bin.count ? formatBin(bin.meanPredicted) : "—"}</span>
          <span>${bin.count ? formatBin(bin.observedRate) : "—"}</span>
          <span>${bin.count}</span>
        </div>`).join("");
      const points = bins.filter((bin) => bin.count);
      const dots = points.map((bin) => `<span class="reliability-dot" style="left:${bin.meanPredicted * 100}%;bottom:${bin.observedRate * 100}%" title="Prediksi ${pct(bin.meanPredicted)} · Aktual ${pct(bin.observedRate)} · n=${bin.count}"></span>`).join("");
      return `
        <div class="backtest-group">
          <strong>${title} · ECE ${formatBin(data.expectedCalibrationError)} · MCE ${formatBin(data.maximumCalibrationError)} · n=${data.sampleSize}</strong>
          <div class="reliability-chart" aria-label="Reliability plot: garis diagonal ideal, titik menunjukkan probabilitas prediksi dan frekuensi aktual">
            <span class="reliability-diagonal"></span>${dots}
          </div>
          <div class="reliability-legend"><span>Y: frekuensi aktual</span><span>X: probabilitas prediksi</span></div>
          <div class="reliability-table">
            <div class="reliability-row reliability-head"><span>Bin</span><span>Prediksi</span><span>Aktual</span><span>n</span></div>
            ${rows}
          </div>
        </div>`;
    };
    const reliabilityHtml = ["raw", "calibrated"].map((kind) => {
      const dataset = kind === "raw" ? result.reliabilityRaw : result.reliability;
      const label = kind === "raw" ? "Raw · semua prediksi" : "Calibrated-only · setelah warm-up";
      return ["home", "draw", "away"].map((outcome) =>
        reliability(`Reliability ${label} · ${outcome.toUpperCase()}`, dataset[outcome])).join("");
    }).join("");
    const leagueRows = result.leagueMetrics.map((league) => {
      const rawLeague = league.rawMetrics;
      const calLeague = league.calibratedMetrics;
      const calOnlyLeague = league.calibrationMetrics;
      return `<tr><td>${escapeHtml(league.league)}</td><td>${league.sampleSize}</td>
        <td>${rawLeague ? metric(rawLeague.logLoss) : "—"}</td><td>${rawLeague ? metric(rawLeague.brierScore) : "—"}</td><td>${rawLeague ? percent(rawLeague.accuracy) : "—"}</td>
        <td>${calLeague ? metric(calLeague.logLoss) : "—"}</td><td>${calLeague ? metric(calLeague.brierScore) : "—"}</td><td>${calOnlyLeague ? metric(calOnlyLeague.logLoss) : "—"}</td><td>${calOnlyLeague ? metric(calOnlyLeague.brierScore) : "—"}</td><td>${calOnlyLeague ? league.calibrationSamples : 0}</td></tr>`;
    }).join("");
    const leagueHtml = result.leagueMetrics.length ? `
      <div class="backtest-group"><strong>Performa per liga · prediksi out-of-sample</strong>
        <div class="table-scroll"><table class="league-table"><thead><tr><th>Liga</th><th>n</th><th>Raw LL</th><th>Raw Brier</th><th>Raw Acc.</th><th>Cal. LL</th><th>Cal. Brier</th><th>Cal-only LL</th><th>Cal-only Brier</th><th>Cal. n</th></tr></thead><tbody>${leagueRows}</tbody></table></div>
        <p class="notice">Bandingkan liga dengan hati-hati: sampel kecil menghasilkan metrik yang tidak stabil. LL = log loss; nilai LL/Brier lebih rendah lebih baik.</p>
      </div>` : "";

    $("backtest-output").insertAdjacentHTML("beforeend",
      `<div class="backtest-group"><strong>Reliability diagram & calibration bins</strong><p class="notice">Setiap grafik memakai pendekatan one-vs-rest untuk Home/Draw/Away. Garis diagonal adalah kalibrasi ideal. Diagram calibrated-only mengecualikan periode warm-up dan bisa kosong jika sampel kalibrasi belum cukup.</p></div>` +
      reliabilityHtml + leagueHtml);
  } catch (error) {
    $("backtest-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function render() {
  try {
    $("error").textContent = "";
    const lh = Number($("lh").value);
    const la = Number($("la").value);
    const rho = Number($("rho").value);
    const matrix = dixonColesScoreMatrix(lh, la, rho, 12);
    const p = matchProbabilities(matrix);
    const home = $("home").value.trim() || "Home";
    const away = $("away").value.trim() || "Away";
    $("match-title").textContent = `${home} vs ${away}`;
    $("probabilities").innerHTML = [
      ["HOME", p.home], ["DRAW", p.draw], ["AWAY", p.away],
      ["OVER 2.5", p.over25], ["UNDER 2.5", p.under25], ["BTTS YES", p.bttsYes]
    ].map(([label, value]) => `<article class="metric"><small>${label}</small><strong>${pct(value)}</strong><span>Fair ${num(fairOdds(value))}</span></article>`).join("");
    try {
      const elo = estimateElo(historicalMatches, home, away, { cutoffDate: $("analysis-date").value });
      const difference = elo.ratingDifference;
      $("elo-output").innerHTML = `<strong>TEAM ELO · ${elo.matchesUsed} laga historis</strong><div class="elo-grid"><span>${escapeHtml(home)}<b>${num(elo.homeRating)}</b></span><span>${escapeHtml(away)}<b>${num(elo.awayRating)}</b></span></div><small>Selisih rating ${difference >= 0 ? "+" : ""}${num(difference)} · expected score kandang ${pct(elo.expectedHomeScore)} (bukan probabilitas menang) · home advantage ${num(elo.homeAdvantage)} poin</small>`;
    } catch (eloError) {
      $("elo-output").textContent = `Elo belum tersedia: ${eloError.message}`;
    }
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
["home","away","lh","la","rho","oh","od","oa","analysis-date"].forEach((id) => $(id).addEventListener("change", render));
setDefaultAnalysisDate();
updateTeamSelectors();
if (historicalMatches.length) {
  $("import-status").textContent = `Memuat ${historicalMatches.length} pertandingan historis tersimpan di perangkat ini.`;
  showImportSummary(historicalMatches.length, historicalMatches.length, 0);
}
render();
