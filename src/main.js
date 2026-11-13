import { scoreMatrix, matchProbabilities, fairOdds, expectedValue } from "./engine.js";
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
      <p class="muted">Analisis awal berbasis distribusi gol. Belum terhubung ke odds API atau data pertandingan otomatis.</p>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">01 / MATCH MODEL</p><h2>Input pertandingan</h2></div><span class="tag">PRE-MATCH</span></div>
      <div class="fields">
        <label>Tim kandang<input id="home" value="Home Team" maxlength="60"></label>
        <label>Tim tandang<input id="away" value="Away Team" maxlength="60"></label>
        <label>Lambda kandang<input id="lh" type="number" min="0" max="8" step="0.01" value="1.55"></label>
        <label>Lambda tandang<input id="la" type="number" min="0" max="8" step="0.01" value="1.10"></label>
      </div>
      <button id="analyze" class="primary">Hitung probabilitas</button>
      <p id="error" class="error" role="alert"></p>
    </section>
    <section class="panel">
      <div class="section-heading"><div><p class="eyebrow">02 / MODEL OUTPUT</p><h2 id="match-title">Home Team vs Away Team</h2></div><span class="tag">POISSON BASELINE</span></div>
      <div id="probabilities" class="metric-grid"></div>
      <p class="notice">Probabilitas dihitung dari lambda yang dimasukkan secara manual. Model Dixon-Coles, kalibrasi, dan data historis belum diaktifkan.</p>
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
        <li>Historical CSV import · team selector · H2H</li>
        <li>Dixon-Coles · Elo · automatic lambda</li>
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
      return `<div class="value-row"><span>${labels[i]}</span><strong>${ev >= 0 ? "+" : ""}${pct(ev)}</strong><small>Model ${pct(values[i])} · Fair ${num(fairOdds(values[i]))} · Odds ${num(odd)}</small></div>`;
    }).join("");
  } catch (error) {
    $("error").textContent = error.message;
  }
}
$("analyze").addEventListener("click", render);
["home","away","lh","la","oh","od","oa"].forEach((id) => $(id).addEventListener("change", render));
render();
