# UPSTREAM.md — anti-slop vendored plugin

## Source identity

- Incoming: skill bundle `install-anti-slop`, snapshot staged 2026-10-21 from
  `<skill-directory>/assets/anti-slop` (local skill installation; no upstream
  repository URL, commit hash, or version is exposed by the bundle — recorded
  as unknown revision, NOT as "latest").
- Installed paths: `tools/oxlint/anti-slop/` (generic entry `index.ts`,
  opt-in Effect entry `effect/index.ts`, vendored
  `vendor/eslint-stylistic/` with its own `UPSTREAM.md` + `LICENSE`).

## Base

- Unknown. The previous installation (15 generic rules, 1 Effect rule,
  3 shared helpers, no provenance record) carried no `UPSTREAM.md` or pristine
  snapshot, so no three-way merge was possible. Treated as a **no-base
  conservative port** per the skill's update procedure: every overlapping-file
  difference was reviewed, all read as upstream evolution (no local policy
  edits detected), and the full incoming snapshot was adopted.
- Pre-update backup (local tree + `.oxlintrc.json`): `/tmp/anti-slop-pre-update-20261021-010059`
  (temporary; remove after accepting this update).

## Adopted changes (incoming → local)

New generic rules: `no-array-filter-map`, `no-reduce-accumulator-copy`
(paired with native `oxc/no-accumulating-spread`), `require-readable-spacing`.
New Effect rules (vendored, NOT registered — repo has no `effect`
dependency): `no-manual-effect-error-tag`, `no-manual-tag-comparison`,
`no-manual-tagged-construction`, `prefer-effect-match`, plus
`effect/shared/tagged-values.ts`.
New shared helpers: `array-method.ts`, `function-parameters.ts`, `scope.ts`,
`type-alias-resolution.ts` (extracted deduplication + scope-aware alias
resolution adopted by `no-object-parameters`, `no-unknown-returns`,
`no-unknown-type-aliases`, `no-unknown-parameters`, `no-known-value-widening`,
`no-unsafe-dictionary-type`, `dictionary-types.ts`, `reflect-method.ts`,
`no-module-mocking.ts`).
Behavior fixes in existing rules: existence-probe exemption
(`no-runtime-typeof`), borrowed-member exemption (`no-shape-in-symbol-names`),
type-predicate-subject exemption (`no-unknown-parameters`), configurable
`markers` option + export-aware lookup (`require-safety-comment-for-type-assertion`).
Vendored `vendor/eslint-stylistic/` (LICENSE + UPSTREAM.md preserved) backing
`require-readable-spacing`.

## Intentional local deviations

- `anti-slop/require-readable-spacing` vendored but set to `"off"` in
  `.oxlintrc.json` per explicit user request (2026-10-21): its 550 findings
  across 25 owned files were deemed too noisy. Re-enable by restoring
  `"error"` and running lint autofix + formatter + re-lint until stable.
- Effect plugin stays unregistered (same as before): no direct `effect`
  dependency in any package manifest. Package-alias imports remain a known
  limitation.

## Deferred / pending

- None from the merge. Open follow-up (needs authorization, NOT done):
  `require-readable-spacing` reports 550 findings across 25 owned files
  (see lint output); cleanup via lint autofix + formatter + re-lint was not
  run — say the word and it will be done as a separate step.

## Dependencies / configuration

- `oxlint` + `@oxlint/plugins` kept at `^1.89.0` (exact compatible pair,
  already installed; incoming source verified working against it — no version
  change required by the adopted source).
- `.oxlintrc.json`: added `oxc/no-accumulating-spread`,
  `anti-slop/no-array-filter-map`, `anti-slop/no-reduce-accumulator-copy`,
  `anti-slop/require-readable-spacing` at `"error"` (existing all-generic-at-error
  policy extended). Ignores and all prior severities untouched.

## Verification (2026-10-21)

- `pnpm lint`: only `require-readable-spacing` fires (550 findings, 25 files);
  no other new or existing rule reports on owned code.
- Explicit probes: `no-array-filter-map` (filter+map chain),
  `no-reduce-accumulator-copy` (`acc.concat`, clean mutating reducer passes),
  `oxc/no-accumulating-spread` (spread accumulator), `require-readable-spacing`
  all fire as documented.
- `pnpm check` (astro, 43 files): 0 errors, 0 warnings, 0 hints.
