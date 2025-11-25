# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Mihon & Aniyomi extensions repository aggregator that:
- Fetches and mirrors extension repositories from multiple sources
- Builds a static website to browse and add extensions
- Deploys to GitHub Pages and Cloudflare Workers
- Automatically updates extensions every 4 hours via GitHub Actions

## Development Commands

```bash
# Install dependencies
bun install

# Start development server with hot reload
bun run dev

# Update extensions from upstream sources
bun run update

# Build the static site (Vite build + copy extensions)
bun run build

# Preview the production build
bun run preview

# Clean the dist directory
bun run clean
```

## Architecture

### Core Build System

The build process uses Vite for the frontend and custom scripts in `scripts/`:

1. **`update.ts`**: Fetches extensions from upstream git repositories
   - Reads `extensions.json` configuration
   - Checks remote git commit hashes for updates
   - Clones repositories to `tmp/` and copies configured files to `extensions/`
   - Updates `extensions.json` with new commit hashes
   - Sets `updated` output for CI/CD workflows

2. **`index.ts`**: Post-build script that copies extension data
   - Runs after Vite build completes
   - Copies extension files from `extensions/` to `dist/`
   - Generates `data.json` with extension sources, domains, and commit info

3. **`clean.ts`**: Removes the `dist/` directory

**Build Order**: `clean → vite build → scripts/index.ts`
- Vite builds the frontend app into `dist/`
- Then `index.ts` copies extension data and generates `data.json`

### Extension Configuration

Extensions are defined in `extensions.json` at the root with a nested structure by category:
```json
{
  "mihon": {
    "keiyoushi": {
      "name": "Keiyoushi",
      "source": "https://github.com/keiyoushi/extensions",
      "path": "/keiyoushi/index.min.json",
      "commit": "..."
    }
  },
  "aniyomi": {
    "kohi-den": { ... }
  }
}
```

Each extension specifies:
- `source`: Git repository URL
- `path`: URL path for the extension index (can include subdirectories like `/yuzono/manga/index.min.json`)
- `commit`: Current tracked commit hash

The key (e.g., "keiyoushi", "yuzono/manga") is used as the directory name in `extensions/` and as part of the URL path.

### Files Copied from Extensions

Defined in `scripts/config.ts` as `filesToCopy`:
- `index.json` - Full extension index
- `index.min.json` - Minified extension index
- `repo.json` - Repository metadata
- `apk/` - APK files directory
- `icon/` - Icon files directory

### Frontend

The frontend is a Preact SPA built with Vite using:
- **Vite**: Build tool with hot module replacement
- **Preact + JSX**: React-compatible UI framework with TSX
- **TypeScript**: Type-safe component development
- **Fuse.js**: Fuzzy search for extensions
- **Hash-based routing**: `#/` for home, `#/search` for search page

**Frontend Structure**:
- `src/App.tsx` - Main application component with routing
- `src/main.tsx` - Application entry point
- `src/components/` - Reusable UI components (MirrorSelector, ExtensionCard, etc.)
- `src/pages/` - Page components (SearchView)
- `src/styles.css` - Global styles
- `index.html` - HTML entry point
- `public/` - Static assets (favicon)

The frontend:
1. Fetches `data.json` on load
2. Displays extension repositories grouped by category
3. Provides mirror domain selection
4. Offers "Add Repo" links using `tachiyomi://` or `aniyomi://` protocols
5. Search page allows browsing all individual extensions from all repos

### Deployment

Configured via `wrangler.toml` and `.github/workflows/update.yml`:

1. **Cloudflare Workers**: Serves static assets from `dist/` via Workers Assets
2. **GitHub Pages**: Deploys `dist/` to the default GitHub Pages site
3. **Orphan branch**: Pushes `dist/` to `repo` branch with `force_orphan` for direct access
4. **GitLab Mirror**: Syncs entire repository to GitLab using SSH

The workflow runs on:
- Schedule: Every 4 hours (`0 */4 * * *`)
- Manual: `workflow_dispatch`

Deployments only occur if:
- Extensions have updates (`updated=true` from `update.ts`)
- Workflow is manually triggered (`workflow_dispatch`)

The workflow has two jobs:
- `build-and-deploy`: Updates extensions, builds, and deploys to all platforms
- `sync-repos`: Mirrors to GitLab (depends on build-and-deploy)

## Important Patterns

### Update Logic

The update script (`scripts/update.ts`) uses smart conditional logic:
- In CI: only downloads if there are actual hash changes
- Locally (non-CI): always downloads to restore missing files
- Manual workflow triggers: force downloads regardless of hash changes
- Individual extensions: re-downloaded if missing, even without hash changes
- Sets `updated` output for CI/CD workflows based on hash changes only

### CI Skip Pattern

Commits from the workflow use `[skip ci]` to prevent recursive builds:
```bash
git commit -m "chore: update extensions.json [skip ci]"
```

### Configuration

All deployable domains are listed in `scripts/config.ts` under `domains`. The frontend allows users to select which mirror to use for extension URLs.
