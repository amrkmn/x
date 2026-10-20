# Mihon & Aniyomi Extensions

[![Visits](https://badges.pufler.dev/visits/amrkmn/x)](https://github.com/amrkmn/x)

Extension repository aggregator that syncs from multiple upstream sources. Updated every 4 hours.

## Links

- [x.noz.one](https://x.noz.one) / [x.ujol.workers.dev](https://x.ujol.workers.dev) — Cloudflare Workers Static Assets
- [x.ujol.dev](https://x.ujol.dev) — Netlify (primary domain)
- [x.amar.kim](https://x.amar.kim) — Netlify (domain alias)

## Available Extensions

### Mihon

- Keiyoushi
- Yuzono Cursed

### Aniyomi

- Secozzi
- Yuzono Anime

## Development

Requires Node.js 24 LTS.

```bash
pnpm install
pnpm run dev            # Start dev server
pnpm run update:check   # Check upstream repos and update extensions.json
pnpm run update:static  # Populate static/ from upstream repos
pnpm run search:update  # Push static/indexes.json to Meilisearch
pnpm run build          # Generate data.json and build dist/
pnpm run check          # Type-check
pnpm run lint           # Run Oxlint
```

## Hosting

Production is built once on GitHub Actions (`.github/workflows/update.yml`, gated on publisher success) and shipped prebuilt to both hosts: Cloudflare Workers Static Assets via `wrangler deploy`, Netlify via `netlify deploy --prod --dir dist`. Direct production auto-deploys from `main` stay disabled on both dashboards.

## Environment

Optional frontend environment variables:

- `PUBLIC_SITE_URL` — canonical site URL
- `PUBLIC_ANALYTICS_DOMAIN` — analytics domain attribute
- `PUBLIC_MEILISEARCH_HOST`
- `PUBLIC_MEILISEARCH_DEFAULT_SEARCH_KEY`
