# At Last

A daily word-chain challenge. This repo is a security-first rebuild of the
original single-file HTML prototype, structured for production deployment.

## Architecture

- **`src/engine/`** — pure TypeScript game logic (deck, dictionary, scoring,
  validation, CPU AI, Daily Challenge replay/verification). Zero DOM or
  network dependencies. Imported by both the browser bundle and the
  Cloudflare Worker, so client and server can never disagree about what's
  a legal play.
- **`src/client/`** — browser UI layer (Vite + TypeScript).
- **`worker/`** — Cloudflare Worker. The *only* thing with write access to
  Firestore. Receives a claimed move history from the client, independently
  re-derives the day's seeded deck, replays the claim against it, and only
  writes the recomputed (not client-reported) result.
- **`public/dictionary.txt`** — the word list as a static, cacheable asset
  (extracted from the prototype's inline string), fetched once by both the
  client and the Worker.
- **`firestore.rules`** — denies all direct client writes. Reads are public
  (results are anonymous, no PII).

## Local setup

```bash
npm install
cp .env.example .env          # fill in real Firebase/reCAPTCHA values
cp worker/.dev.vars.example worker/.dev.vars   # fill in your service account JSON
```

Run the frontend:
```bash
npm run dev
```

Run the Worker locally (separate terminal):
```bash
npm run worker:dev
```

Build check:
```bash
npm run build
```

## Deployment

**Frontend (Cloudflare Pages):** connect this repo in the Cloudflare
dashboard (Workers & Pages → Create → Pages). Build command `npm run build`,
output directory `dist`. Deploys automatically on push to `main` via
Cloudflare's native Git integration — no GitHub Actions needed for this part.

**Worker + Firestore rules:** deployed via GitHub Actions
(`.github/workflows/deploy-worker.yml` and `deploy-firestore-rules.yml`) on
every push to `main` that touches the relevant paths. Requires these repo
secrets (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, right sidebar of any domain overview |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase console → Project Settings → Service accounts → Generate new private key (paste the full file contents) |

## Current status

The engine, Worker, and Daily Challenge trust pipeline (client records
moves → Worker independently replays and verifies → single trusted write →
aggregate percentile/histogram returned in the same response) are complete.

`src/client/main.ts` is currently a placeholder that verifies the build
pipeline end-to-end (dictionary loads, engine imports resolve). The full
screen-by-screen UI port from the original prototype is in progress.

Online multiplayer is intentionally not yet implemented — see project notes
for the phased plan. It will follow the same server-authoritative pattern
as Daily Challenge before shipping.
