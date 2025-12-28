# Agent Instructions for Mihon/Aniyomi Extensions Aggregator

SvelteKit static site that aggregates Mihon and Aniyomi extensions. Uses Bun runtime exclusively.

## Quick Reference

| Task                 | Command                           |
| -------------------- | --------------------------------- |
| Install dependencies | `bun install`                     |
| Development server   | `bun run dev`                     |
| Build static site    | `bun run build`                   |
| Preview build        | `bun run preview`                 |
| Type check           | `bun run check`                   |
| Type check (watch)   | `bun run check:watch`             |
| Format code          | `bun run format`                  |
| Lint (check format)  | `bun run lint`                    |
| Update extensions    | `bun run update`                  |
| Run all tests        | `bun test`                        |
| Run single test      | `bun test tests/debounce.test.ts` |
| Watch tests          | `bun test --watch`                |

## Environment & Toolchain

- **Runtime**: Bun only. Never use `npm`, `yarn`, or `pnpm`.
- **Framework**: SvelteKit with Svelte 5 and static adapter.
- **Language**: TypeScript with strict mode enabled.
- **Search**: Meilisearch (client-side).

## Code Style (Prettier-enforced)

- **Indentation**: 4 spaces (not tabs).
- **Quotes**: Single quotes only.
- **Trailing Commas**: None.
- **Line Width**: 100 characters max.
- **Line Endings**: LF (`\n`) on all platforms.

## TypeScript Guidelines

- **Strict mode** is enabled. Avoid `any` unless absolutely necessary.
- Use standard ESM imports with `$lib/` alias for `src/lib/`.
- Define interfaces for all data structures in dedicated type files.
- Prefer optional chaining (`?.`) and nullish coalescing (`??`) over non-null assertions (`!`).

```typescript
// Good
const value = data?.nested?.property ?? 'default';
// Avoid
const value = data!.nested!.property;
```

## Naming Conventions

| Type                | Convention | Example                      |
| ------------------- | ---------- | ---------------------------- |
| Svelte components   | PascalCase | `ExtensionCard.svelte`       |
| TS utilities        | camelCase  | `meilisearch.ts`             |
| SvelteKit routes    | +prefix    | `+page.svelte`, `+layout.ts` |
| Variables/Functions | camelCase  | `formatSourceName`           |
| Types/Interfaces    | PascalCase | `ExtensionRepo`              |

## Project Structure

```
src/lib/components/  # Reusable Svelte 5 components
src/lib/search/      # Meilisearch integration
src/lib/stores/      # Svelte stores
src/lib/types.ts     # Core type definitions
src/routes/          # SvelteKit pages
scripts/update.ts    # Extension update entry point
scripts/cache/       # S3/R2 caching system (read CLAUDE.md first)
scripts/config.ts    # Domain and file configuration
tests/               # Test files (*.test.ts)
static/              # Generated extension data and assets
```

## Testing

**Framework**: `bun:test` built-in test runner.
**Test file pattern**: `tests/<module>.test.ts`

```typescript
import { expect, test } from 'bun:test';
import { myFunction } from '../src/lib/path/to/module';

test('description of what it tests', async () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
});

// For async delays, use Bun.sleep (not setTimeout)
await Bun.sleep(100);
```

**Current test coverage**: `src/lib/search/` utilities, `scripts/cache/` utilities.

## Error Handling

**Scripts** (`scripts/`):

- Use try/catch in async functions.
- Log errors explicitly via console or the `log` utility from `scripts/cache/logger.ts`.

**Frontend** (`src/`):

- Handle fetch failures gracefully (e.g., when `data.json` fails to load).
- Never let errors crash the UI silently.

```typescript
try {
    await someAsyncOperation();
} catch (error) {
    console.error('Failed to complete operation:', error);
    throw error; // Re-throw if caller needs to handle
}
```

## Svelte 5 Components

- Always use `<script lang="ts">`.
- Components go in `src/lib/components/`.
- Prefer component-scoped styles over global CSS.
- Use Svelte 5 runes syntax (`$state`, `$derived`, `$effect`).

## Verification Workflow

After making changes, always run:

1. `bun run check` - Type checking (primary safety net).
2. `bun test` - Run test suite.
3. `bun run format` - Ensure consistent formatting.
4. `bun run build` - Verify static build succeeds.

## Common Tasks

**Add a new component**:

1. Create `src/lib/components/Name.svelte` with Svelte 5 + TypeScript.
2. Run `bun run format && bun run check`.

**Modify extension logic**:

1. Edit `scripts/update.ts` or `scripts/config.ts`.
2. Test with `bun run update --generate-only`, then `bun run check`.

**Add a new test**:

1. Create `tests/<module>.test.ts` with `import { test, expect } from 'bun:test'`.
2. Run `bun test tests/<module>.test.ts`.

**Update dependencies**: `bun add <package>` or `bun add -d <package>`. Never edit `bun.lock` manually.

## Important Notes

- **Cache system** (`scripts/cache/`): Complex distributed system with S3 storage, manifest tracking, and distributed locking. Read `CLAUDE.md` before modifying.
- **CI**: GitHub Actions in `.github/workflows/update.yml`. Updates run every 4 hours.
- **Environment**: Local dev requires `.env` file. See `.env.example` for S3 configuration.

## Key Files Reference

| File                | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `extensions.json`   | Extension source configuration                  |
| `static/data.json`  | Generated extension data (consumed by frontend) |
| `src/lib/types.ts`  | Core TypeScript interfaces                      |
| `scripts/config.ts` | Domains and file paths configuration            |
| `CLAUDE.md`         | Detailed architecture documentation             |
