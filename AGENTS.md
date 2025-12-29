# Agent Instructions for Mihon/Aniyomi Extensions Aggregator

This repository aggregates Mihon and Aniyomi extensions into a SvelteKit static site.

## ⚡ Quick Reference

| Task           | Command                                 |
| :------------- | :-------------------------------------- |
| **Install**    | `bun install` (Never use npm/yarn)      |
| **Dev Server** | `bun run dev`                           |
| **Build**      | `bun run build` (Generates static site) |
| **Type Check** | `bun run check` (Primary safety net)    |
| **Format**     | `bun run format` (Prettier)             |
| **Lint**       | `bun run lint` (Check formatting)       |
| **Test All**   | `bun test`                              |
| **Test File**  | `bun test tests/debounce.test.ts`       |
| **Update Ext** | `bun run update`                        |

## 🛠 Environment & Stack

- **Runtime**: **Bun** exclusively.
- **Framework**: SvelteKit with Svelte 5 (Runes) + `@sveltejs/adapter-static`.
- **Language**: TypeScript (Strict mode).
- **Search**: Meilisearch (Client-side integration).
- **CI**: GitHub Actions (Updates extensions every 4h).

## 📝 Code Style & Conventions

### General

- **Indentation**: 4 spaces.
- **Quotes**: Single quotes.
- **Line Width**: 100 chars.
- **Line Endings**: LF (`\n`) everywhere.
- **Imports**: Use standard ESM. Use `$lib/` alias for `src/lib/`.

### TypeScript

- **Strict Mode**: Enabled. Avoid `any`.
- **Null Safety**: Prefer `?.` and `??` over `!`.
- **Types**: Define interfaces in dedicated `types.ts` files or `src/lib/types.ts`.

### Bun Specifics

- **File I/O**: Use `await Bun.file('path').json()` or `.text()`.
- **Shell**: Use `import { $ } from 'bun'` for shell commands.
- **Async**: Use `await Bun.sleep(ms)` instead of `setTimeout`.
- **Tests**: Use `import { test, expect } from 'bun:test'`.

### Naming

| Entity           | Convention | Example                      |
| :--------------- | :--------- | :--------------------------- |
| Components       | PascalCase | `ExtensionCard.svelte`       |
| Types/Interfaces | PascalCase | `ExtensionRepo`              |
| Files (Svelte)   | PascalCase | `ExtensionCard.svelte`       |
| Files (TS)       | camelCase  | `meilisearch.ts`             |
| Functions/Vars   | camelCase  | `fetchData`                  |
| Routes           | SvelteKit  | `+page.svelte`, `+layout.ts` |

### Svelte 5

- Always use `<script lang="ts">`.
- Use **Runes**: `$state`, `$derived`, `$effect`, `$props`.
- Store components in `src/lib/components/`.
- Prefer component-scoped styles.

## 📂 Project Structure

```text
src/
  lib/
    components/   # Reusable Svelte 5 components
    search/       # Meilisearch integration
    stores/       # Svelte stores
    types.ts      # Core type definitions
  routes/         # SvelteKit pages (+page.svelte)
scripts/
  cache/          # S3/R2 caching system (Distributed locking)
  config.ts       # Domain and file configuration
  update.ts       # Main extension update script
static/           # Generated assets & data.json
tests/            # Bun test files (*.test.ts)
extensions.json   # Extension source configuration
```

## 🧪 Testing & Verification

**Framework**: `bun:test`

**Pattern**:

```typescript
import { expect, test } from 'bun:test';
import { myFunc } from '../src/lib/utils';

test('feature works', async () => {
    const res = myFunc();
    expect(res).toBe(true);
});
```

**Verification Workflow**:
Before submitting changes, run this sequence:

1. `bun run check` (Fix all type errors)
2. `bun test` (Ensure no regressions)
3. `bun run format` (Apply standard formatting)
4. `bun run build` (Verify static generation)

## ⚠️ Error Handling

- **Scripts**: Wrap async operations in `try/catch`. Log errors explicitly using `console.error` or `scripts/cache/logger.ts`.
- **Frontend**: Handle fetch failures gracefully (e.g. `data.json` load failure). Never crash the UI.

## 🔄 Extension Updates

- **Logic**: `scripts/update.ts` handles fetching, cloning, and updating `extensions.json`.
- **Cache**: `scripts/cache/` manages S3 storage. Read `CLAUDE.md` before touching cache logic.
- **Config**: Add new extensions to `extensions.json`.
