# Mihon & Aniyomi Extensions

A repository aggregator for Mihon and Aniyomi extensions that automatically syncs from multiple upstream sources.

## Links

- [x.noz.one](https://x.noz.one)
- [x.ujol.dev](https://x.ujol.dev)
- [x.ujol.workers.dev](https://x.ujol.workers.dev)

## Features

- Automatic updates every 4 hours from upstream extension repositories
- Static website for browsing and adding extensions
- Multiple deployment mirrors (GitHub Pages, Cloudflare Workers)
- Built with SvelteKit and Vite
- Search functionality for all extensions across repositories

## Extension Sources

### Mihon Extensions

- **Keiyoushi** - Community-maintained Mihon extensions
- **Yuzono Manga** - Manga extensions

### Aniyomi Extensions

- **Kohi-den** - Anime extensions
- **Yuzono Anime** - Anime extensions

## Development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Update extensions from upstream
bun run update

# Build for production
bun run build
```
