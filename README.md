# Data Sync Pipeline & Metrics Service

A backend service that pulls data from HubSpot (CRM), Google Calendar (events), and Stripe (payments) into a single Postgres database — and exposes a metrics API that computes revenue without ever drifting between views.

---

## What This Does (and Why It's Hard)

Three different APIs. Three different data shapes. Three different ideas of what "cursor" means.

HubSpot tracks contacts and uses a numeric `after` cursor. Google Calendar uses a `syncToken` that expires. Stripe uses the ID of the last record you saw as a `starting_after` cursor. None of them agree on anything.

The job of this service is to pull all three into one normalized schema, recover gracefully when a cursor goes stale (which Google Calendar will do if you haven't synced in a while), and never write a duplicate row even if the same job runs twice back-to-back.

On the metrics side: different payment processors use different words for "this payment actually went through." Stripe says `succeeded`. Some others say `paid` or `completed`. The service normalizes all of these to a single canonical value (`collected`) at write time, and uses a strict allow-list when computing revenue — not an exclusion list. The distinction matters: an exclusion list silently accepts any status that isn't explicitly blocked. A new status sneaks through as revenue. An allow-list only counts what it explicitly recognizes.

---

## Architecture

```
┌──────────────┐   ┌─────────────────┐   ┌──────────────┐
│   HubSpot    │   │  Google Calendar│   │    Stripe    │
│  (Contacts)  │   │   (Events)      │   │  (Charges)   │
└──────┬───────┘   └────────┬────────┘   └──────┬───────┘
       │                    │                   │
       └────────────────────┼───────────────────┘
                            │
                    Promise.allSettled()
                    (one failing never blocks others)
                            │
                    ┌───────▼────────┐
                    │  Sync Pipeline │
                    │  - Cursors     │
                    │  - Idempotent  │
                    │    upserts     │
                    │  - 410 fallback│
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │   Supabase     │
                    │   (Postgres)   │
                    │                │
                    │ unified_records│
                    │ transactions   │
                    │ sync_state     │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  Metrics API   │
                    │  /total        │
                    │  /breakdown    │
                    └────────────────┘
```

---

## Running Locally

### Prerequisites
- Node.js 18+
- A Supabase project (free at [supabase.com](https://supabase.com))
- A HubSpot developer account with a Private App token
- A Stripe account in test mode
- A Google Cloud service account with Calendar API access

### Setup

```bash
git clone <your-repo-url>
cd assignent-2
npm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```env
HUBSPOT_ACCESS_TOKEN=pat-na2-xxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
GOOGLE_CALENDAR_ID=your-email@gmail.com
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
```

Place your Google service account JSON file in the project root as `google-credentials.json`.

Start the server:

```bash
npm run dev
```

The server will auto-run migrations and trigger an initial sync on startup.

### Seed Stripe with Test Data

```bash
npm run seed:stripe
```

This creates 4 successful and 1 declined test charge in Stripe — useful for verifying that failed payments don't show up in revenue totals.

---

## API Endpoints

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/trigger` | Kick off a sync across all three sources |
| `GET`  | `/sync/status`  | See the last stored cursor per source |

### Data

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/records` | All synced CRM contacts and calendar events |
| `GET` | `/records?source=hubspot` | Filter by source (`hubspot` or `gcal`) |
| `GET` | `/transactions` | All synced Stripe charges |
| `GET` | `/health` | Health check (used by Render) |

### Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/metrics/total` | Total collected revenue (all time or filtered by date) |
| `GET` | `/metrics/breakdown` | Day-by-day revenue breakdown |

Both metrics endpoints accept optional `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` params.

---

## Testing the Failure Cases

### Stale cursor recovery (410 fallback)

Run this SQL in your Supabase dashboard to corrupt the HubSpot cursor:

```sql
UPDATE sync_state SET cursor = 'invalid-stale-cursor-123' WHERE source = 'hubspot';
```

Then trigger a sync:

```bash
curl -X POST http://localhost:3000/sync/trigger
```

Watch the server logs. HubSpot will 410, the service will log a warning, clear the cursor, and immediately re-fetch everything from scratch.

### Idempotency check

Trigger the same sync twice in a row:

```bash
curl -X POST http://localhost:3000/sync/trigger
curl -X POST http://localhost:3000/sync/trigger
```

Run `curl http://localhost:3000/records` — the count will be identical. No duplicates.

### Source failure isolation

With `Promise.allSettled`, if one source throws, the others still commit. You can verify this by temporarily setting `HUBSPOT_ACCESS_TOKEN=invalid` in your env and triggering a sync — Calendar and Stripe will still succeed.

---

## Deploying to Render

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) and create a new **Web Service**.
3. Connect your GitHub repo. Render will detect the `Dockerfile` automatically.
4. Under **Environment Variables**, add:
   - `DATABASE_URL` — your Supabase connection string
   - `HUBSPOT_ACCESS_TOKEN`
   - `STRIPE_SECRET_KEY`
   - `GOOGLE_CALENDAR_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_CREDENTIALS_JSON` — paste the **entire contents** of your `google-credentials.json` file as a single value
5. Click **Deploy**.

The `/health` endpoint is configured as the Render health check path.

---

## Tradeoffs

**SQLite locally, Postgres in production:** The app uses Knex so switching databases is one env var. SQLite keeps local setup fast with no Docker required.

**No job queue:** Syncs run as async functions inside the web process rather than a separate worker. For this scale it's fine. For production you'd want BullMQ or a cron-triggered Lambda.

**Cursor strategy per source:** Each source has its own cursor semantics. HubSpot uses a numeric offset. GCal uses a syncToken. Stripe uses the last record ID. Each job handles its own cursor independently — there's no shared abstraction because the semantics are genuinely different.

**Metrics consistency:** Both `/metrics/total` and `/metrics/breakdown` call the same base query function (`getCollectedRevenueBaseQuery`). They physically cannot drift. If someone adds a second metrics calculation elsewhere, they'd have to duplicate that function — which is the signal to catch during code review.

**Google Calendar on Render:** The credentials JSON can't be uploaded as a file to Render, so the service reads it from a `GOOGLE_CREDENTIALS_JSON` environment variable when running in the cloud, and from a file path locally.

---

## Sources & References

- [HubSpot Contacts API docs](https://developers.hubspot.com/docs/api/crm/contacts) — cursor pagination for incremental fetches
- [HubSpot Private Apps](https://app-na2.hubspot.com/private-apps/246826362/46610309/auth) — token generation
- [Stripe Charges API](https://stripe.com/docs/api/charges/list) — `starting_after` cursor pattern
- [Stripe test cards](https://stripe.com/docs/testing) — `tok_visa` and `tok_chargeDeclined` for seeding
- [Stripe Dashboard (test mode)](https://dashboard.stripe.com/acct_1Tvu6tEGFHc7NZEU/test/apikeys)
- [Google Calendar Events API](https://developers.google.com/calendar/api/v3/reference/events/list) — syncToken incremental sync
- [Google Cloud Console](https://console.cloud.google.com/products) — enabling APIs
- [Google Cloud IAM Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=snappy-mapper-503207-i2) — service account creation
- [Reddit thread on disabling `iam.disableServiceAccountKeyCreation`](https://www.reddit.com/r/googleworkspace/comments/1biw03d/service_account_key_creation_is_disabled/) — turned out the Organization Policy needed to be overridden at the org level, not the project level
- [Google Org Policy docs](https://docs.cloud.google.com/resource-manager/docs/manage-baseline-constraints) — understanding baseline constraints
- [Supabase project dashboard](https://supabase.com/dashboard/project/nsxhkandtqdhrayqcjqj) — Postgres connection string
- [Knex.js docs](https://knexjs.org/) — query builder with `onConflict().merge()` for idempotent upserts
- [googleapis npm package](https://www.npmjs.com/package/googleapis) — Google Calendar Node.js client

---