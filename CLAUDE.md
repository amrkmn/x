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

# Build the static site
bun run build

# Preview the production build
bun run preview

# Format code with Prettier
bun run format

# Check code formatting
bun run lint
```

## Architecture

### Core Build System

The build process uses Vite with SvelteKit and custom scripts:

1. **`scripts/update.ts`**: Main extension update and data generation script
   - Fetches extensions from upstream git repositories
   - Reads `extensions.json` configuration at project root
   - Checks remote git commit hashes for updates
   - Clones repositories to `tmp/` and copies configured files to `static/`
   - Updates `extensions.json` with new commit hashes
   - Generates `static/data.json` with extension metadata
   - Supports `--generate-only` flag to regenerate `data.json` without fetching updates
   - Sets `updated` output for CI/CD workflows

2. **Build order**: `update --generate-only → vite build`
   - First, `data.json` is regenerated from current extension state
   - Then Vite builds the SvelteKit app into `dist/`
   - Static assets from `static/` are included in the build

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
    },
    "yuzono/manga": {
      "name": "Yuzono Manga",
      "source": "https://github.com/yuzono/manga-repo",
      "path": "/yuzono/manga/index.min.json",
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
- `path`: URL path for the extension index (can include subdirectories)
- `commit`: Current tracked commit hash
- The key (e.g., "keiyoushi", "yuzono/manga") is used as the directory name in `static/` and as part of the URL path

### Files Copied from Extensions

Defined in `scripts/config.ts` as `filesToCopy`:
- `index.json` - Full extension index
- `index.min.json` - Minified extension index
- `repo.json` - Repository metadata
- `apk/` - APK files directory
- `icon/` - Icon files directory

### Frontend

The frontend is a SvelteKit static site built with Vite:

- **SvelteKit**: Framework with static adapter (`@sveltejs/adapter-static`)
- **Svelte 5**: Modern reactive UI framework
- **TypeScript**: Type-safe component development
- **Fuse.js**: Fuzzy search for extensions
- **Prerendering**: All pages are prerendered at build time (`prerender = true`)

**Frontend Structure**:
- `src/routes/+layout.ts` - Loads `data.json` and provides it to all pages
- `src/routes/+page.svelte` - Home page with extension categories
- `src/routes/search/+page.svelte` - Search page with all extensions
- `src/lib/components/` - Reusable UI components:
  - `ExtensionCategory.svelte` - Category display with repos
  - `ExtensionCard.svelte` - Individual repo card
  - `ExtensionRow.svelte` - Table row for search results with NSFW badge
  - `MirrorSelector.svelte` - Domain selection dropdown
  - `Footer.svelte` - Page footer
- `src/lib/stores/` - Svelte stores for state management
- `src/lib/types.ts` - TypeScript type definitions
- `src/app.css` - Global styles including NSFW badge styling
- `src/app.html` - HTML template

The frontend:
1. Fetches `data.json` on initial load via `+layout.ts`
2. Displays extension repositories grouped by category (mihon/aniyomi)
3. Provides mirror domain selection for extension URLs
4. Offers "Add Repo" links using `tachiyomi://` or `aniyomi://` protocols
5. Search page allows browsing all individual extensions from all repos
6. Shows NSFW badge for extensions with adult content (when `nsfw: 1`)

### Extension Data Structure

Extensions fetched from upstream repositories contain:
- `name`: Display name (e.g., "Tachiyomi: MangaDex")
- `pkg`: Package identifier (e.g., "eu.kanade.tachiyomi.extension.en.mangadex")
- `version`: Version string
- `lang`: Language code (e.g., "en", "all")
- `apk`: APK filename
- `nsfw`: Integer flag (1 = NSFW content, 0 = safe)

### Deployment

Configured via `wrangler.toml` and `.github/workflows/update.yml`:

1. **Cloudflare Workers**: Serves static assets from `dist/` via Workers Assets
   - Entry point: `scripts/worker.ts` - Simple fetch handler that proxies to Workers Assets binding
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

The update script (`scripts/update.ts`) uses a dual-config sync system:

- `extensions.json` (root): The desired/target state
- `static/data.json`: Contains the successfully synced state (what's actually downloaded)

Update flow:
1. Compare remote hash with synced hash (from `data.json`)
2. If different, or if files are missing in `static/`, queue for update
3. Clone and copy files for each extension
4. **Only after successful clone/copy**, update `extensions.json` with new commit hash
5. Generate new `data.json` with updated commit info
6. Failed clones don't update hashes, ensuring retry on next run

CI behavior:
- In CI: only downloads if there are actual hash changes
- Locally (non-CI): always downloads to restore missing files
- Manual workflow triggers: force downloads regardless of hash changes
- Sets `updated` output for CI/CD workflows based on successful updates only

### CI Skip Pattern

Commits from the workflow use `[skip ci]` to prevent recursive builds:

```bash
git commit -m "chore: update extensions.json [skip ci]"
```

### Code Standards

- **Line Endings**: LF (Line Feed) is enforced project-wide via:
  - `.gitattributes`: `* text=auto eol=lf`
  - `.prettierrc`: `"endOfLine": "lf"`
  - This ensures cross-platform consistency (Windows/Linux/CI)

- **Formatting**: Prettier with:
  - 4 spaces for indentation
  - Single quotes
  - No trailing commas
  - 100 character line width

### Configuration

All deployable domains are listed in `scripts/config.ts` under `config.domains`. The frontend allows users to select which mirror to use for extension URLs.
