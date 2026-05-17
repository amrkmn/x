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
- Yuzono Manga
- Yuzono Cursed

### Aniyomi

- Kohi-den
- Yuzono Anime

## Development

```bash
bun install
bun run dev            # Start dev server
bun run update:check   # Check upstream repos and update extensions.json
bun run update:static  # Populate static/ from upstream repos
bun run build          # Generate data.json and build dist/
bun run check          # Type-check
```
