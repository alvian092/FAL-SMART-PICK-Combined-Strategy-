import test from "node:test";
import assert from "node:assert/strict";
import { estimateLambdas } from "../src/engine.js";

function dateAt(day) {
  return new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10);
}

function sampleHistory() {
  const matches = [];
  for (let day = 1; day <= 25; day += 1) {
    matches.push({
      date: dateAt(day), league: day % 2 ? "League A" : "League B", season: "2025",
      homeTeam: "Home FC", awayTeam: `Opponent ${day}`,
      homeGoals: day === 25 ? 5 : 1, awayGoals: 0
    });
    matches.push({
      date: dateAt(day), league: "Cup", season: "2025",
      homeTeam: `Opponent ${day}`, awayTeam: "Away FC",
      homeGoals: 0, awayGoals: day === 25 ? 4 : 1
    });
  }
  return matches;
}

test("automatic lambda uses at most the latest 20 appearances from all competitions", () => {
  const result = estimateLambdas(sampleHistory(), "Home FC", "Away FC", {
    cutoffDate: "2025-01-26"
  });
  assert.equal(result.home.appearances, 20);
  assert.equal(result.away.appearances, 20);
  assert.equal(result.home.newestDate, "2025-01-25");
  assert.equal(result.home.oldestDate, "2025-01-06");
  assert.equal(result.away.newestDate, "2025-01-25");
  assert.ok(result.lambdaHome > 0);
  assert.ok(result.lambdaAway > 0);
});

test("automatic lambda excludes matches on or after the analysis date", () => {
  const result = estimateLambdas(sampleHistory(), "Home FC", "Away FC", {
    cutoffDate: "2025-01-20"
  });
  assert.equal(result.home.newestDate, "2025-01-19");
  assert.equal(result.away.newestDate, "2025-01-19");
  assert.equal(result.home.appearances, 19);
});

test("recent form has greater influence when recency weighting is enabled", () => {
  const matches = sampleHistory();
  const weighted = estimateLambdas(matches, "Home FC", "Away FC", {
    cutoffDate: "2025-01-26", recencyDecay: 0.5
  });
  const unweighted = estimateLambdas(matches, "Home FC", "Away FC", {
    cutoffDate: "2025-01-26", recencyDecay: 1
  });
  assert.ok(weighted.lambdaHome > unweighted.lambdaHome);
  assert.ok(weighted.lambdaAway > unweighted.lambdaAway);
});

test("automatic lambda reports sample dates and fallback baseline transparently", () => {
  const matches = [{
    date: "2025-01-01", league: "League", season: "2025",
    homeTeam: "A", awayTeam: "B", homeGoals: 0, awayGoals: 0
  }];
  const result = estimateLambdas(matches, "A", "B");
  assert.equal(result.usedFallbackBaseline, true);
  assert.equal(result.home.appearances, 1);
  assert.equal(result.away.appearances, 1);
});

test("automatic lambda rejects missing history, same teams, and invalid options", () => {
  const matches = sampleHistory();
  assert.throws(() => estimateLambdas(matches, "Unknown", "Away FC"), /no eligible matches/i);
  assert.throws(() => estimateLambdas(matches, "Home FC", "Home FC"), /different/i);
  assert.throws(() => estimateLambdas(matches, "Home FC", "Away FC", { cutoffDate: "2025-02-30" }), /YYYY-MM-DD/i);
  assert.throws(() => estimateLambdas(matches, "Home FC", "Away FC", { limit: 0 }), /limit/i);
});
