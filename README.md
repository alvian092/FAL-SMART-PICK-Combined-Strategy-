# FAL SMART PICK — Combined Strategy

An Android-first Football Analytics Lab project. This repository starts with a small, testable foundation; features are added in verified stages.

## Current foundation

- Vite web application packaged for Android with Capacitor 7.
- Deterministic Poisson score matrix.
- 1X2, Over/Under 2.5, and BTTS baseline probabilities.
- Fair decimal odds, expected value, and no-vig probability helpers.
- Manual lambda and odds input for an initial vertical slice.
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
- Historical predictions must use only information available before kickoff.
- Store prediction timestamp, model version, input snapshot, odds snapshot, and final result for auditability.
- Do not count H2H records twice when they are already part of each team's match history.
- Separate probability ranking from value ranking. A high win probability is not automatically positive expected value.
- Use walk-forward or time-ordered validation; do not tune on the same matches used for evaluation.
- Treat positive EV as a model estimate, not a guarantee.

## Planned stages

1. Historical CSV import, validation, team/league selector, and H2H.
2. Automatic lambda with home/away strength and opponent adjustment.
3. Dixon-Coles and Elo with calibration tests.
4. All requested markets with correct Asian line settlement and fair odds.
5. Combined Smart Pick ranking, uncertainty gates, and NO BET.
6. Walk-forward backtesting, ROI, yield, CLV, drawdown, and calibration.
7. Live match state model and Android UX hardening.
8. Release signing only after Debug is green and signing configuration is verified.

## Important

This is an analytics tool, not a betting guarantee or financial advice. Never present an output as a certain result.
