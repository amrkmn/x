# Project Overview: Mihon & Aniyomi Extensions Aggregator

## Purpose
A repository aggregator that automatically syncs Mihon and Aniyomi extensions from multiple upstream sources and deploys them to multiple mirrors.

## Architecture

### Core Components

1. **Extension Configuration** (`extensions.json`)
   - Defines upstream extension sources
   - Tracks commit hashes for each source
   - Uses object keys (e.g., `keiyoushi`, `kohi-den`, `yuzono`) as directory identifiers
   - Properties: `name`, `source`, `path`, `category`, `commit`

2. **Build Scripts** (`scripts/`)
   - `update.ts` - Fetches extensions from upstream git repositories
   - `index.ts` - Post-build script that copies extensions to dist and generates data.json
   - `config.ts` - Central configuration for domains, directories, and files to copy
   - `types.ts` - TypeScript type definitions

3. **Frontend** (`src/`)
   - Preact SPA built with Vite
   - Hash-based routing (`#/`, `#/search`)
   - Features mirror domain selection
   - Provides "Add Repo" functionality with `tachiyomi://` and `aniyomi://` protocols

### Build Process

1. `bun run update` - Checks for upstream updates and downloads extensions
2. `bun run build` - Runs Vite build, then copies extensions to dist/
3. Extensions copied from `extensions/` to `dist/`
4. `data.json` generated with extension sources, domains, and commit info

### Deployment

**Multiple deployment targets:**
- **GitHub Pages**: `x.amar.kim` (custom domain)
- **Cloudflare Workers**: `x.ujol.workers.dev`
- **Additional mirrors**: `x.noz.one`, `x.ujol.dev`
- **GitLab mirror**: Synced to GitLab repository

**CI/CD Workflow** (`.github/workflows/update.yml`)
- Runs every 4 hours or on manual trigger
- Only deploys if extensions have updates
- Commits use `[skip ci]` to prevent recursive builds
- GitLab sync explicitly checks out `main` branch with `ref: main`

### Recent Refactoring

**Removed `dirname` property** (completed)
- Previously: Extension config had redundant `dirname` property
- Now: Uses object keys directly as directory identifiers
- Updated files: `scripts/types.ts`, `scripts/update.ts`, `scripts/index.ts`, `extensions.json`

### Custom Domain Setup

**GitHub Pages Custom Domain**: `x.amar.kim`
- CNAME file created in `public/CNAME`
- Replaced `amrkmn.github.io/x` in config
- All domains now serve from root path `/`
- DNS CNAME record needed: `x.amar.kim` → `amrkmn.github.io`

## Extension Sources

1. **Keiyoushi** - Mihon extensions (manga)
2. **Kohi-den** - Aniyomi extensions (anime)
3. **Yuzono** - Aniyomi extensions (anime)

## Key Patterns

- Smart update logic: Only downloads in CI if hash changes, always downloads locally
- Extensions tracked by commit hash for change detection
- Multiple mirrors ensure availability
- Vite publicDir copies `public/` contents (including CNAME) to dist automatically
