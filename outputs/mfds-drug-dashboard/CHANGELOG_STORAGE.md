# Change Log Storage

The medicine change log uses local JSON files by default:

- `data/change-log.json`
- `data/snapshots/*.json`

For durable storage across Vercel redeploys, connect Neon Postgres. Vercel KV or Upstash Redis REST can remain as a fallback.

Storage priority:

1. Neon Postgres
2. Vercel KV / Upstash Redis
3. Local JSON files

## Environment Variables

Set the same values in both places:

- Vercel project environment variables
- GitHub repository Secrets used by the daily update workflow

Recommended Neon variable:

- `DATABASE_URL`

Alternative Neon variable names are also supported:

- `NEON_DATABASE_URL`
- `POSTGRES_URL`

Fallback KV variable names:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Direct Upstash names are also supported:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional:

- `CHANGELOG_KV_PREFIX`

If `CHANGELOG_KV_PREFIX` is not set, the app uses `medicine-change-log`.

## Behavior

When Neon variables are present, the dashboard reads change logs from Neon first. The daily update script writes to Neon and also updates the JSON files as a backup. If Neon is not configured but KV/Upstash variables are present, KV is used next.

When all external storage variables are absent, the existing JSON-only behavior remains unchanged.

## Neon Schema

Run `db/schema.sql` in the Neon SQL Editor before the first scheduled update. The app also creates the change-log tables automatically at runtime, but running the schema explicitly is safer for production setup.
