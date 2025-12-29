# Project: x (Mihon & Aniyomi Extensions Aggregator)

## Overview

A repository aggregator for Mihon and Aniyomi extensions that automatically syncs from multiple upstream sources. The project fetches extension repositories, mirrors them locally, builds a static website for browsing, and uses S3-compatible caching for fast restoration.

## Tech Stack

- **Runtime/Package Manager:** Bun
- **Frontend:** SvelteKit 2.x with Svelte 5, Vite 7
- **Language:** TypeScript
- **Search:** Meilisearch for advanced search with filtering and faceting
- **Formatting:** Prettier (4 spaces, single quotes, no trailing commas, 100 char width, LF line endings)
- **Deployment:** Static site (GitHub Pages, Cloudflare Workers)

## Architecture

### Directory Structure

- **`src/`:** SvelteKit frontend application
  - `src/routes/+layout.ts` - Loads `data.json` and provides it to all pages
  - `src/routes/+page.svelte` - Home page with extension categories
  - `src/routes/search/+page.svelte` - Search page with all extensions
  - `src/lib/components/` - Reusable UI components (ExtensionCard, ExtensionCategory, ExtensionRow, MirrorSelector, Footer)
  - `src/lib/stores/` - Svelte stores for state management
  - `src/lib/search/` - Meilisearch integration and search utilities
  - `src/lib/types.ts` - TypeScript type definitions

- **`scripts/`:** Bun scripts for project maintenance
  - `scripts/update.ts` - Main extension update and data generation script
  - `scripts/cache.ts` - Cache orchestration (restore/save with locking)
  - `scripts/cache/` - Cache subsystem modules:
    - `files.ts` - Tar archive creation/extraction with zstd compression
    - `lock.ts` - Distributed lock implementation using S3 metadata
    - `manifest.ts` - Cache manifest management
    - `metadata.ts` - Cache metadata storage (checksums, timestamps)
    - `s3.ts` - S3 client wrapper and cache operations
    - `logger.ts` - Logging utilities for transfers
    - `utils.ts` - Shared utilities
  - `scripts/config.ts` - Configuration (domains, files to copy, GitHub info)
  - `scripts/meilisearch.ts` - Meilisearch indexing for search functionality
  - `scripts/worker.ts` - Cloudflare Workers deployment script

- **`static/`:** Static assets and generated extension files
  - `static/data.json` - Generated extension metadata for frontend
  - `static/{repo-key}/` - Extension files (index.json, index.min.json, repo.json, apk/, icon/)

- **`tmp/`:** Temporary directory for git clones during updates

- **`extensions.json`:** Configuration file at project root defining extension sources (nested by category: mihon/aniyomi)

### Extension Configuration

Extensions are defined in `extensions.json` with nested structure by category:

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

- `source`: Git repository URL
- `path`: URL path for the extension index (can include subdirectories)
- `commit`: Current tracked commit hash
- Key (e.g., "keiyoushi", "yuzono/manga") is used as directory name in `static/` and URL path

### Files Copied from Extensions

Defined in `scripts/config.ts` as `filesToCopy`:
- `index.json` - Full extension index
- `index.min.json` - Minified extension index
- `repo.json` - Repository metadata
- `apk/` - APK files directory
- `icon/` - Icon files directory

### Data Types

**AppData** (generated in `static/data.json`):
- `extensions`: Record of extension categories (mihon/aniyomi) with repos
- `domains`: List of mirror domains for URL selection
- `source`: GitHub repository URL
- `latestCommitHash`: Latest commit hash
- `commitLink`: Link to latest commit

**ExtensionRepo**:
- `name`: Display name
- `source`: Git repository URL
- `path`: URL path for extension index
- `commit`: Tracked commit hash

**Extension** (from upstream repos):
- `name`: Display name (e.g., "Tachiyomi: MangaDex")
- `pkg`: Package identifier
- `version`: Version string
- `lang`: Language code (e.g., "en", "all")
- `apk`: APK filename
- `nsfw`: Integer flag (1 = NSFW, 0 = safe)
- `sourceName`: Source repository name

## Core Update System

### Dual-Config Sync System

- **`extensions.json`** (root): The desired/target state with commit hashes to track
- **`static/data.json`**: Contains the successfully synced state (what's actually downloaded)

### Update Flow (`scripts/update.ts`)

1. Read `extensions.json` (target state) and `static/data.json` (synced state)
2. For each extension:
   - Fetch remote commit hash from git repository
   - Compare remote hash with synced hash (from `data.json`)
   - If different, or if files are missing in `static/`, queue for update
3. Clone repositories to `tmp/` and copy configured files to `static/`
4. **Only after successful clone/copy**, update `extensions.json` with new commit hash
5. Generate new `static/data.json` with updated commit info
6. Failed clones don't update hashes, ensuring retry on next run

### Update Modes

- **Default mode**: Full update with S3 cache operations (restore → update → save)
- **`--quick`**: Fast mode for CI - only updates `extensions.json` with new hashes, skips cache operations
- **`--generate-only`**: Regenerate `data.json` from current state without fetching or cache operations (used in build)
- **`--no-cache`**: Disable cache operations

### CI Behavior

- In CI: only downloads if there are actual hash changes
- Locally (non-CI): always downloads to restore missing files
- Manual workflow triggers: force downloads regardless of hash changes
- Sets `updated` output for CI/CD workflows based on successful updates only

## Caching System

S3-compatible storage (Cloudflare R2, Backblaze B2, AWS S3) for distributed caching:

### Cache Features

- **Storage Format**: Compressed tar.zst files in S3 bucket
- **Compression**: tar with zstd for fast compression/decompression
- **Manifest System**: JSON manifest tracks all cache entries with metadata
- **Distributed Locking**: S3 metadata and conditional writes with instance IDs
- **Cache Validation**: File checksums validate integrity before restoration
- **Automatic Cleanup**: Keeps 10 most recent caches, removes entries older than 30 days

### S3 Configuration

Environment variables in `.env`:
- `S3_ENDPOINT`: S3 endpoint URL (e.g., `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` for R2)
- `S3_ACCESS_KEY_ID`: Access key ID
- `S3_SECRET_ACCESS_KEY`: Secret access key
- `S3_BUCKET_NAME`: Bucket name
- `S3_REGION`: Region (use "auto" for R2)

### Cache Flow

**Restore**:
1. Resolve cache key using manifest (exact match or prefix fallback)
2. Validate local cache using checksums (skip download if valid)
3. Download tar.zst file from S3
4. Extract to `static/` directory
5. Update access timestamps in manifest

**Save**:
1. Acquire distributed lock using instance ID
2. Compress `static/` directory to tar.zst with checksums
3. Upload to S3 with streaming multipart upload
4. Save metadata (checksums, file list) to S3
5. Update manifest with new cache entry
6. Clean up old cache entries (keep 10 most recent, max age 30 days)
7. Release lock

## Build System

### Build Order

`update --generate-only → vite build`

1. First, `data.json` is regenerated from current extension state
2. Then Vite builds the SvelteKit app into `dist/`
3. Static assets from `static/` are included in the build

### Frontend

- **SvelteKit**: Framework with static adapter (`@sveltejs/adapter-static`)
- **Svelte 5**: Modern reactive UI framework
- **Prerendering**: All pages are prerendered at build time (`prerender = true`)

Frontend flow:
1. Fetches `data.json` on initial load via `+layout.ts`
2. Displays extension repositories grouped by category (mihon/aniyomi)
3. Provides mirror domain selection for extension URLs
4. Offers "Add Repo" links using `tachiyomi://` or `aniyomi://` protocols
5. Search page allows browsing all extensions with advanced filtering
6. Shows NSFW badge for extensions with adult content (when `nsfw: 1`)

## CI/CD & Deployment

### GitHub Actions (`.github/workflows/update.yml`)

**Schedule**: Every 4 hours (`0 */4 * * *`)

**Triggers**:
- Schedule: Every 4 hours
- Manual: `workflow_dispatch`
- Push to main branch (excluding bot commits)

**Jobs**:
1. **`update`**: Updates extensions using quick mode (`--quick`), commits changes to `extensions.json`
   - Uses `[skip ci]` pattern to prevent recursive builds
   - Outputs `updated=true` when changes occur

2. **`sync-to-gitlab`**: Mirrors repository to GitLab for backup
   - Runs after update when `updated=true` or on manual dispatch
   - Uses SSH for authentication

**Deployment triggers**:
- Extensions have updates (`updated=true` from `update.ts`)
- Workflow is manually triggered

### Deployment Targets

- **Domains** (defined in `scripts/config.ts`):
  - https://x.noz.one
  - https://x.ujol.dev
  - https://x.amar.kim
  - https://x.ujol.workers.dev

## Standards

- **Line Endings**: LF (Line Feed) enforced via:
  - `.gitattributes`: `* text=auto eol=lf`
  - `.prettierrc`: `"endOfLine": "lf"`
  - Ensures cross-platform consistency (Windows/Linux/CI)

- **Formatting**: Prettier with:
  - 4 spaces for indentation
  - Single quotes
  - No trailing commas
  - 100 character line width

## Important Patterns

### CI Skip Pattern

Commits from workflow use `[skip ci]` to prevent recursive builds:
```bash
git commit -m "chore: update extensions.json"
```

### Configuration

All deployable domains are listed in `scripts/config.ts` under `config.domains`. The frontend allows users to select which mirror to use for extension URLs.
