# Project: x (Mihon & Aniyomi Extensions Aggregator)

## Overview
A repository aggregator for Mihon and Aniyomi extensions that automatically syncs from multiple upstream sources.

## Tech Stack
- **Runtime/Package Manager:** Bun
- **Frontend:** SvelteKit, Vite
- **Language:** TypeScript
- **Formatting:** Prettier

## Architecture
- **`src/`:** SvelteKit frontend application.
- **`scripts/`:** Bun scripts for project maintenance.
- **`static/`:** Static assets and generated `data.json`.
- **`extensions.json`:** Configuration file defining extension sources.

## Scripts & Automation
- **`scripts/update.ts`:** The core script.
    - Updates extensions from upstream Git repositories.
    - Generates `static/data.json` for the frontend.
    - Supports `--generate-only` flag to generate `data.json` without fetching updates (used for build).
- **Refactoring (Dec 2025):**
    - `scripts/index.ts` was merged into `scripts/update.ts` to reduce redundancy.
    - `scripts/clean.ts` was removed as it was unused.
    - `package.json` build script updated to use `bun run scripts/update.ts --generate-only`.

## Standards
- **Line Endings:** LF (Line Feed) is enforced project-wide via `.gitattributes` and `.prettierrc` to ensure cross-platform consistency (Windows/Linux/CI).

## Deployment
- **Targets:** GitHub Pages and Cloudflare Workers.
- **CI/CD:** GitHub Actions workflow (`.github/workflows/update.yml`) handles updates every 4 hours and on dispatch.
