# FAL SMART PICK — Combined Strategy

An Android-first Football Analytics Lab project. This repository starts with a small, testable foundation; features are added in verified stages.

## Current foundation

- Vite web application packaged for Android with Capacitor 7.
- Deterministic Poisson score matrix.
- 1X2, Over/Under 2.5, and BTTS baseline probabilities.
- Fair decimal odds, expected value, and no-vig probability helpers.
- Manual lambda and odds input for an initial vertical slice.
- Automatic lambda from each team’s latest 20 appearances across all imported competitions, with venue/opponent adjustment, recency weighting, and a pre-match date cutoff.
- Dixon-Coles low-score correction for 0–0, 0–1, 1–0, and 1–1 scorelines, with validated rho and normalized score probabilities.
- Chronological Elo ratings across imported fixtures, with configurable K-factor/home advantage and a strict pre-match cutoff. Elo expected score is shown separately from match-win probability.
- Multiclass temperature scaling for 1X2 probabilities, fitted by minimizing log loss on prior out-of-sample predictions.
- Expanding-window walk-forward backtesting with strict calendar-date separation, per-team history gates, skipped-fixture reporting, raw/calibrated log loss, multiclass Brier score, and accuracy.
- One-vs-rest 1X2 reliability diagrams and 10-bin calibration tables with ECE/MCE diagnostics.
- Deterministic fixture-bootstrap sensitivity intervals for 1X2, Over 2.5, BTTS Yes, and team lambdas, using only pre-match history.
- Out-of-sample per-league scorecards for raw and calibrated log loss, Brier score, accuracy, and sample counts.
- Node.js unit tests.
- GitHub Actions workflow that tests, builds the web bundle, generates the Android project, assembles a Debug APK, verifies it exists, and uploads it as an artifact.

## Run locally

Requirements: Node.js 22 and npm.

```bash
npm install
npm test
npm run build
npm run dev
```

## Android Debug build

```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

The GitHub Actions workflow performs this sequence on pushes to `main` and `develop/**`, pull requests to `main`, and manual dispatch. It does not create a signed Release APK.

## Model and data integrity rules

- Missing statistics or odds must remain missing; never fabricate values.
- Historical predictions must use only information available before kickoff; Dixon-Coles and Elo both enforce a strict date cutoff.
- Elo expected score is not a 1X2 win probability; keep it separate from calibrated match-market probabilities.
- Store prediction timestamp, model version, input snapshot, odds snapshot, and final result for auditability.
- Do not count H2H records twice when they are already part of each team's match history.
- Separate probability ranking from value ranking. A high win probability is not automatically positive expected value.
- Use walk-forward or time-ordered validation; do not tune on the same matches used for evaluation. The backtest excludes all same-day fixtures from training, and the temperature calibrator only sees earlier out-of-sample forecasts.
- Report warm-up and calibrated-only metrics separately; do not imply that calibration is active before enough prior forecasts exist.
- Treat positive EV as a model estimate, not a guarantee.

## Planned stages

1. Historical CSV import, validation, team/league selector, and H2H.
2. Automatic lambda with home/away strength and opponent adjustment.
3. Dixon-Coles low-score adjustment and chronological Elo ratings with regression tests (implemented).
4. Temperature calibration, leakage-safe walk-forward evaluation, reliability diagrams, calibration bins, and per-league diagnostics (implemented); uncertainty intervals remain planned.
5. All requested markets with correct Asian line settlement and fair odds.
6. Combined Smart Pick ranking, uncertainty gates, and NO BET.
7. Walk-forward backtesting, ROI, yield, CLV, drawdown, and calibration.
7. Live match state model and Android UX hardening.
9. Release signing only after Debug is green and signing configuration is verified.

## Important

This is an analytics tool, not a betting guarantee or financial advice. Never present an output as a certain result.
