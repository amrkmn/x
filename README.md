# Mihon & Aniyomi Extensions

[![Visits](https://badges.pufler.dev/visits/amrkmn/x)](https://github.com/amrkmn/x)

Extension repository aggregator that syncs from multiple upstream sources. Updated every 4 hours.

## Links

- [x.noz.one](https://x.noz.one) / [x.ujol.workers.dev](https://x.ujol.workers.dev)
- [x.ujol.dev](https://x.ujol.dev)
- [x.amar.kim](https://x.amar.kim)

## Available Extensions

### Mihon

- Keiyoushi
- Yuzono Cursed

### Aniyomi

- Kohi-den
- Yuzono Anime

## Development

Requires Node.js 24 LTS.

```bash
pnpm install
pnpm run dev            # Start dev server
pnpm run update:check   # Check upstream repos and update extensions.json
pnpm run update:static  # Populate static/ from upstream repos
pnpm run build          # Generate data.json and build dist/
pnpm run check          # Type-check
pnpm run lint           # Run Oxlint
```

## Render

For a Render Static Site, use:

- Build command: `pnpm install --frozen-lockfile && pnpm run build`
- Publish directory: `dist`

## Environment

Optional frontend environment variables:

- `PUBLIC_SITE_URL` — canonical site URL
- `PUBLIC_ANALYTICS_DOMAIN` — analytics domain attribute
- `PUBLIC_MEILISEARCH_HOST`
- `PUBLIC_MEILISEARCH_DEFAULT_SEARCH_KEY`
