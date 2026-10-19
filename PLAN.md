# GitHub Releases artifact mirror overhaul

## Tracking status

This PR starts as a plan-only change and will track the implementation. Keep the phase checkboxes here and the high-level checklist in the PR description in sync as work lands.

- [x] Phase 0 — Confirm publishing and catalog contracts (done 2026-10-19; encoder decode-proof and final recount owned by Phase 4 / Phase 6 gates)
- [ ] Phase 1 — Move scheduled update checks to Forgejo
- [ ] Phase 2 — Publish immutable GitHub Releases
- [ ] Phase 3 — Keep hosted catalogs and site data lightweight
- [ ] Phase 4 — Update download links and preserve repository endpoints
- [x] Phase 5 — Remove the artifact cache and binary host sync (done 2026-10-19 in `965b5bb`; codec renames in `ecc16b1`)
- [ ] Phase 6 — Bootstrap, cut over, and verify

Progress 2026-10-19: Phase 0 complete (`f8e0a52`, `f21d151`, `9704cf2`). The encoder decode-proof runs with Phase 4 implementation; the final recount runs at bootstrap per Phase 6. Phase 1 in-repo work is done (Kohi-den removal, Forgejo check workflow, GitHub workflow trim); its gate still waits on Forgejo-side sync, the first scheduled run, and mirror-push verification. Phase 2 publisher code, tests, and workflow are implemented on `plan/github-release-artifacts`; no live release has been created. Phase 2's gate remains open until the merged GitHub workflow is exercised end to end. Phase 3 lightweight-catalog code is implemented on `plan/github-release-artifacts` (no APK/JAR materialization, Secozzi wrapper parsing, binary pruning, optional manifest overlay); verified locally with 82 tests, `pnpm check`/`lint`, and a `prepare-dist` run producing a binary-free `dist/` with complete catalogs (1,699 records across the four sources). No download-link cutover: entries keep upstream URLs until the publisher produces a manifest (Phase 4). (Counts superseded: 54 tests as of Phase 5 after cache-test removal; catalog re-verified binary-free during Phase 5 validation — entry totals move with upstream pins.)

## Confirmed scope

- Keep the Mihon/Aniyomi website and its lightweight catalog, search data, indexes, and other required small files on the existing hosted sites.
- Retire Kohi-den: its original upstream has stopped, and its current mirror is served from the owner's Forgejo instance. Keep the other four sources (two Mihon and two Aniyomi).
- Publish APKs and available Mihon JARs as GitHub Release assets in the existing `amrkmn/x` repository; do not create a second artifact repository.
- Use immutable releases and upload only new or changed binary artifacts. Retain prior release assets.
- Use the Forgejo runner on the confirmed schedule `0 */4 * * *` UTC. It commits changes to `extensions.json` and mirrors them to GitHub.
- Use GitHub Actions for release publication, triggered by a `main` push that changes `extensions.json`.
- Generate a mirror-owned Mihon `index.pb` for each Mihon source, with APK URLs pointing to this repository's Releases. Preserve each source's APK `signingKey` and mirror the original APK bytes unchanged; the protobuf index itself is not signed.
- Remove the R2/S3 artifact cache and stop sending APK/JAR files to Cloudflare Workers, Render, or the VPS/DUFS deployment.
- The PR began as plan-only; implementation changes will follow the reviewed phases and stay tracked in this PR.

The Forgejo schedule is set to `0 */4 * * *` in UTC (every four hours).

## Current implementation

- `extensions.json` now contains two Mihon and two Aniyomi sources; Kohi-den was removed in Phase 1. The Secozzi path switch to `/secozzi/index.json` is still pending (Phase 3).
- `.forgejo/workflows/check.yml` runs `pnpm run update:check` on `0 */4 * * *` UTC, formats, and commits only `extensions.json`, pushing through the Forgejo→GitHub mirror.
- `.github/workflows/publish.yml` publishes changed binaries to immutable releases after `extensions.json` changes on `main`; `.github/workflows/update.yml` runs only after that workflow succeeds, then syncs the site to DUFS. Git mirrors live in `.github/workflows/mirror.yml`: a single matrix job pushes every `main` push fast-forward-only to Forgejo and GitLab over SSH.
- `scripts/publish.ts` is the publisher CLI/orchestrator; `scripts/releases/` separates source discovery, manifest/batch planning, GitHub API calls, shared JSON parsing, and contracts. Current real discovery resolves 3,144 artifacts (2,878 Keiyoushi, 12 Cursed, 3 Secozzi, 251 Anime); sampled upstream checksums matched for Keiyoushi APK/JAR, Cursed APK, and Secozzi APK.
- `scripts/extensions.ts` materializes only lightweight files into `static/` (`index.json`, `index.min.json`, `index.pb`, `repo.json`, `icon` per `config.filesToCopy`); `pruneBinaryDirs` removes any legacy `apk/`/`jar/` subdirs. It also generates the website's catalog and search data.
- Phase 5 removed the S3-compatible artifact cache (`scripts/cache.ts` and `scripts/cache/` deleted); `scripts/task.ts` no longer restores or saves any cache.
- The frontend uses `apkUrl` directly and renders Jar iff `jarUrl` is present; the hosted `/apk/` + `/jar/` fallbacks were removed in Phase 4 (`src/lib/components/ExtensionRow.svelte`).
- The local Keiyoushi artifact-repository example uses release URLs in its catalog and a `release-assets.json` index containing asset names and SHA-256 values. Use it as a reference, not as an assumption that all four retained sources expose artifacts identically.

## Current artifact inventory

Validated 2026-10-19 against the source commits currently pinned in `extensions.json` (excluding retired Kohi-den):

| Source        | Pinned ref |      APKs |      JARs | Total files |
| ------------- | ---------- | --------: | --------: | ----------: |
| Keiyoushi     | `db80c78`  |     1,439 |     1,439 |       2,878 |
| Yuzono Cursed | `692d2a7`  |         6 |         6 |          12 |
| Secozzi       | `c6459f1`  |         3 |         0 |           3 |
| Yuzono Anime  | `d4fac05`  |       251 |         0 |         251 |
| **Total**     |            | **1,699** | **1,445** |   **3,144** |

These are current versions only, not all historical upstream releases, and count each source artifact separately without cross-source hash deduplication. Recount from the pinned source indexes immediately before the bootstrap.

**Secozzi index path (resolved 2026-10-19, switched in Phase 3):** `extensions.json` previously selected `/secozzi/index.min.json`, a stale single Animiru placeholder. The authoritative catalog is `index.json` (a `NetworkExtensionStore` wrapper) plus `release-assets.json`, listing three current APKs (Jellyfin, Stremio, Torbox) at the pinned ref. The catalog parser targets `/secozzi/index.json` with shape-aware wrapper parsing, keeping the Aniyomi category.

## Target flow

1. **Forgejo checks upstreams.** First remove Kohi-den from `extensions.json`; its original upstream has stopped, so do not poll or republish the owner's Forgejo mirror. On `0 */4 * * *` UTC, the runner checks the four retained sources, changes only their source commit values, and commits only when values changed. Forgejo's GitHub mirror push is the event that starts the GitHub workflow.
2. **GitHub publishes binaries.** A workflow on `main` runs only when `extensions.json` changes. It reads the updated source indexes, finds the current APKs and available Mihon JARs, hashes them, and compares them with the last published asset manifest. It mirrors APK/JAR bytes without re-signing them.
3. **GitHub creates immutable releases when binaries changed.** Upload only changed files; never replace an asset in an existing release. Include a full current `release-assets.json` snapshot with each release. The snapshot maps source/package/artifact kind to version, filename, SHA-256, and the immutable release URL. Keep the manifest in release assets rather than committing generated state back to `main`, so GitHub does not diverge from Forgejo's mirrored branch. The initial bootstrap is split across at least four releases for the current 3,144-file inventory, with no more than 999 binaries plus one manifest per release. Do not publish the catalog until all bootstrap releases are complete.
4. **Catalog/site deployment follows publication.** Generate or refresh the lightweight site catalog and search data using the immutable URLs from the current asset manifest. Generate a mirror-owned `index.pb` for each Mihon source, replacing only its APK URLs and preserving its source `signingKey`; update each corresponding `repo.json` to point at the mirror index. Publish indexes and site files only after their referenced release assets exist.
5. **Hosted endpoints remain binary-free.** Continue serving the web UI and required small catalog/index/icon files at the existing domains and paths. No APK or JAR should be present in the hosted build output or sent to DUFS, Workers, or Render.

If a run changes source metadata but produces no changed APK/JAR bytes, it should update any needed lightweight catalog/site data without creating an empty binary release.

## Implementation plan

### Phase 0 — Confirm publishing and catalog contracts

- [x] Inventory APK and JAR metadata/URLs for the four retained sources, including sources not backed by a GitHub repository; exclude Kohi-den. (Validated 2026-10-19 at pinned refs: Keiyoushi 1,439 APK + 1,439 JAR via release-download URLs; Yuzono Cursed 6 + 6; Secozzi 3 APK via wrapper `index.json`, 0 JAR; Yuzono Anime 251 APK under git-tree `apk/`, 0 JAR. Total 1,699 APK + 1,445 JAR = 3,144.)
- [x] Confirm from Mihon source that `index.pb` is Protobuf data, not a signed index; its `signingKey` field verifies APK signatures. Preserve each source key and the APK bytes unchanged, so no upstream private key is needed to rewrite APK URLs.
- [x] Select and validate an encoder for regenerated per-source indexes; prove the generated bytes decode with Mihon's `NetworkExtensionStore` parser before cutover. (Done 2026-10-19: protobufjs with `.proto` transcribed from field numbers; hermetic proof 1439/1439 real Keiyoushi entries round-trip exact. In-app Mihon acceptance tracked at the Phase 4 gate.)
    - Selected: protobufjs with a `.proto` transcribed from `NetworkExtensionStore.kt` field numbers. Proof deferred to Phase 4 implementation (its gate requires Mihon acceptance). Gotchas confirmed against pinned indexes: JSON source `id`s are strings exceeding 2^53 (encode via string→int64, never JS number); proto `Resources` has no `jarUrl` (website-only); absent `homeUrl`/`mirrorUrls`/`discord` map to proto defaults; `contentWarning` uses `CONTENT_WARNING_*` names; `extensionListUrl` (102) is absent upstream (null).
- [x] Treat Secozzi's `index.json` and `release-assets.json` as authoritative for its three active APKs; the configured `index.min.json` is a stale legacy placeholder. Implementation must set the source path to `/secozzi/index.json` and parse its `NetworkExtensionStore` wrapper without changing the Aniyomi category.
- [ ] Recount the current artifact set immediately before bootstrap and split it into releases with at most 999 binary assets plus one manifest each (GitHub allows 1,000 assets per release). Preliminary recount 2026-10-19 at pinned refs: 3,144 binaries (1,699 APK + 1,445 JAR); must re-run immediately before bootstrap as pins may move.
- [x] Define an artifact identity and compare by SHA-256, with package/source and artifact kind as the stable key; preserve version/version-code fields for display.
- [x] Choose a deterministic, unique release tag derived from the triggering update commit or source revisions. Tag format `<shortSHA>-<n>` where shortSHA is the triggering `extensions.json` commit and n is the batch sequence within that commit. Rerun behavior: verify-and-skip an existing matching release; fail on a conflicting tag or checksum; never overwrite existing assets.
- [x] Define collision-safe release asset names and the exact `release-assets.json` schema. Asset files are source-prefixed (`<sourcekey>-<upstream-name>`, with `/` normalized to `-`). The manifest is nested `sourceKey -> packageName -> {apk?, jar?}`; each artifact record contains `name`, `sha256`, `version`, optional `versionCode`, `source`, `kind`, and immutable release `url`. Each new release carries the same complete current manifest, retaining URLs for unchanged assets from older releases.
- [x] Verify which hosted deployments are automatic on GitHub pushes and how they will be ordered after release publication. Findings 2026-10-19: Render static site builds `dist` from `main` (auto-deploy per dashboard — confirm); DUFS sync is the `sync-to-dufs` workflow job; Workers (`wrangler.toml` assets) has no in-repo deploy workflow (manual/external); GitLab mirror purpose unverified (possibly legacy). Ordering rule: the release publisher runs first on `extensions.json` changes; site deployments trigger only after referenced release assets exist, and site builds fetch the current manifest from GitHub Releases, never from `main`. Keep site deployments that are still needed; remove only binary transfer/cache responsibilities.
- [x] Determine whether any configured source can update without a binary change and ensure that catalog-only updates still deploy correctly. Yes: upstream revisions can change metadata with byte-identical APK/JARs. The publisher then creates no release but must still trigger a lightweight site/catalog refresh.

**Gate:** The release publisher can build a complete current asset manifest, identify exactly which APK/JAR bytes are new without modifying GitHub's mirrored branch, and produce bootstrap batches that stay within the per-release asset cap.

### Phase 1 — Move scheduled update checks to Forgejo

- [x] Configure the Forgejo runner schedule as `0 */4 * * *` UTC. (Declared 2026-10-19 in `.forgejo/workflows/check.yml`; takes effect once the Forgejo repo syncs this branch. No `server_url` guards remain in `.github/` workflows: when both directories exist Forgejo processes only `.forgejo/` and ignores `.github/` (forgejo/forgejo#9203), so the GitHub workflows never load on Forgejo.)
- [x] Remove Kohi-den from `extensions.json` and stop checking its owner's Forgejo mirror; the original upstream has stopped. (Done 2026-10-19; four sources remain. Only favicon/robots/sitemap are tracked under `static/`, so no generated files needed committing.)
- [x] Reuse or adapt the existing `update:check` behavior to compare refs for the four retained sources and update only `extensions.json`. (No code change needed 2026-10-19: quick mode compares remote heads and writes only `extensions.json`; Kohi-den removal leaves exactly the four retained sources.)
    - Runner procedure is encoded in `.forgejo/workflows/check.yml` (`0 */4 * * *` UTC + manual dispatch): fresh checkout; setup (pnpm + Node 24 + install via `pnpm/setup`, which refuses to update the lockfile in CI); `pnpm run update:check`; `pnpm run format`; if the `updated` output is not `true` then stop, else commit just `extensions.json` and push through the Forgejo→GitHub mirror. Never run materialization or commit anything else on the runner. Pre-condition: sync the Forgejo repo with GitHub `main` first (Kohi-den removal, both workflow changes), or the runner works from stale config.
- [ ] Commit only `extensions.json` when source commit values change; configure the Forgejo mirror to push that commit to GitHub `main`.
    - Sync topology (each direction has exactly one writer): pin commits originate only on Forgejo and reach GitHub via the Forgejo push-mirror; everything else flows GitHub→Forgejo via `.github/workflows/mirror.yml` (all `main` pushes, fast-forward-only manual push, URL in `FORGEJO_REPO`, key in `FORGEJO_SSH`); GitHub→GitLab shares the same matrix job. The Forgejo repo must be a regular repo (never a pull-mirror, or scheduled syncs would clobber workflow commits), default branch `main`, Actions enabled. Merge this plan branch to `main` first — the Forgejo schedule cannot see `check.yml` until the merge has synced across.
    - Forgejo repo setup (do after merging to `main`): migrate `github.com/amrkmn/x` into an empty regular `x` repo on `noz.one` (one-time clone, never a pull-mirror); add a push-mirror to GitHub with a `contents: write` token; confirm Actions is enabled with an `ubuntu-latest` runner; create an Authorized Integration for `x` on `noz.one` (audience `u:1:e50a06e0-00b6-499c-9044-5b3eed4dae1c`, already wired into `check.yml` — the audience is an identifier, not a secret, so no secret setup is needed); add the `FORGEJO_REPO` secret on GitHub (`git@noz.one:ujol/x.git` via the `FORGEJO_REPO` secret, authenticated by the `FORGEJO_SSH` private key with `write:repository`); manual-dispatch `check.yml` once as a dry run before the schedule takes over.
- [x] Remove the scheduled update-check and update-commit responsibility from `.github/workflows/update.yml`. (Done 2026-10-19: schedule trigger and check/format/commit steps removed; Phase 2 now triggers deployment only after the release publisher succeeds; permissions remain `contents: read`; DUFS gate preserved via a `setup` job. GitHub no longer commits, so the mirror cannot diverge.)
- [ ] Verify a real Forgejo mirror push produces a GitHub `push` event; do not have the release workflow commit generated state back to `main`.

**Gate:** An upstream revision change produces one Forgejo commit limited to `extensions.json` and starts the intended GitHub workflow; an unchanged check produces no commit or release run.

### Phase 2 — Publish immutable GitHub Releases

- [x] Add a GitHub Actions workflow filtered to `main` and `paths: [extensions.json]`, with manual dispatch only as a recovery option. (`workflow_dispatch` is recovery-only; the downstream site workflow runs on successful `workflow_run` so it cannot race release publication.)
- [x] Grant only the permissions needed to create releases and upload assets; serialize publication runs for `main`. (`contents: write`; one non-canceling `release-publisher-main` concurrency group.)
- [x] Fetch current source indexes for the four retained sources and resolve each listed APK and available Mihon JAR. Do not fetch or publish Kohi-den artifacts. Handle each source's actual index layout rather than assuming one shared URL/schema. (Uses the three wrapped `index.json` catalogs plus their upstream asset manifests, and Anime's flat `index.min.json` plus pinned `apk/` path.)
- [x] Download candidate assets, reject missing/empty or ambiguous files, compute SHA-256, and compare against the prior full release manifest. (Validates upstream checksums for the three sources with `release-assets.json`; Anime has no upstream checksum manifest.)
- [x] Create a deterministic immutable release only when binary bytes changed. Upload changed APK/JAR assets plus a complete current `release-assets.json`; reuse prior immutable URLs for unchanged bytes. (Stages drafts, verifies all asset names/digests, then publishes; no release for metadata-only changes.)
- [x] Preserve historical releases when an extension is removed or superseded. Remove it from the current manifest only after confirming it is no longer advertised by its source. (Only the newly generated current snapshot omits removed entries; prior releases/assets are untouched.)
- [x] Make reruns idempotent: an existing release with matching hashes is accepted without re-upload; mismatches fail visibly. (Matching partial drafts resume by adding only missing assets; published releases are verification-only.)

**Gate:** Each release stays within GitHub's 1,000-asset cap; the first run can bootstrap the complete current inventory across the planned batches; a second run over identical bytes creates no new binary release or assets, and no existing release asset is overwritten. The planner and fake-client tests cover these cases, and real pinned-index discovery found 3,144 artifacts; PR #4 merged 2026-10-19 and the first GitHub-hosted bootstrap run (actions run 39223736129) is underway, so the phase gate remains open pending its verification.

### Phase 3 — Keep hosted catalogs and site data lightweight

- [x] Refactor the source materialization in `scripts/extensions.ts` so index/catalog refreshes do not copy APKs or JARs into `static/`. (Done 2026-10-19: `filesToCopy` retains only index files, `repo.json`, and `icon`; `materializeExtensions` wipes and recopies from that list.)
- [x] Update `scripts/config.ts` and source fetch logic to retain only the index, repository metadata, and supporting small files required by the site and app repository endpoints. (Done 2026-10-19; sparse checkout follows the same list. Icons: `fetchMissingIcons` backfills wrapper-source icons (Keiyoushi/Cursed/Secozzi) from upstream `iconUrl` into `static/<key>/icon/` during materialization and on update runs; failures keep the upstream URL. Verified 2026-10-19: 1,439/1,439 Keiyoushi icons fetched with 0 failures, mirror rewrite to `x.noz.one` URLs confirmed. Anime carries no `iconUrl` and is skipped by construction; its branch-shipped icons serve the frontend `${repoUrl}/icon/` fallback.)
- [x] Generate the website's `static/data.json` and `static/indexes.json` from current source metadata and the complete release asset manifest. (Done 2026-10-19 as an optional overlay: `generateDataJson` accepts a `ReleaseManifest` or `RELEASE_MANIFEST_FILE`; manifest-covered packages resolve to immutable release URLs, everything else keeps upstream URLs. No manifest exists yet — the publisher is not live — so current output is metadata plus upstream URLs; catalog-only updates with no new release flow through unchanged.)
- [x] Keep the four retained source entries; remove Kohi-den from generated catalogs and stop serving its current index endpoint. Point Secozzi at `/secozzi/index.json` and parse its wrapper without changing its Aniyomi category. Ensure source removals/renames are deliberate rather than cache-restore side effects. (Done 2026-10-19: path switched, wrapper parsing is shape-aware in `loadRepoExtensions` and search-index mapping, sentinel follows the Aniyomi path basename; `pruneRemovedRepos` plus scoped `pruneBinaryDirs` run on every non-quick update. Local `prepare-dist` confirmed Kohi-den absent and Secozzi contributing its 3 wrapper entries as Aniyomi.)
- [x] Verify the generated `dist/` has no `.apk` or `.jar` files while it still contains every required catalog, search, index, and site file. (Done 2026-10-19 locally: `prepare-dist` fails the run when `findBinaryArtifacts('dist')` is non-empty; observed run produced 0 binaries with `data.json`, `indexes.json`, per-source `index.json`/`index.min.json`/`index.pb`/`repo.json`/`icon` intact. Hosted Render/Workers/DUFS ordering still verifies with Phase 6, since no live deployment has run this code.)

**Gate:** The hosted site builds and retains all existing catalog/search/repository paths without materializing binary artifacts.

### Phase 4 — Update download links and preserve repository endpoints

- [x] Make website APK and Mihon JAR links resolve to explicit immutable URLs from `release-assets.json`; remove fallback links to hosted `/apk/` or `/jar/` paths. (Done 2026-10-19 in `e3b5b50`: `ExtensionRow` uses `apkUrl` directly, Jar iff `jarUrl`; hosted `/apk/`+`/jar/` fallbacks removed; no hosted binary links across 1,699 live entries.)
- [x] Preserve the existing Add Repo / Copy Index URL behavior, mirror selector, and hosted repository paths. (Done 2026-10-19 in `e3b5b50`: `MirrorSelector`, copy-URL in `ExtensionCard`, and hosted repository paths untouched.)
- [x] Generate a mirror-owned Mihon `index.pb` per Mihon source with `resources.apkUrl` values pointing to immutable Release URLs; preserve the source `signingKey`, extension metadata, and APK bytes. (Done 2026-10-19 in `e3b5b50`: `refreshMirrorIndexPb` regenerates per-source `index.pb` via `generate-index.ts` with manifest overlay — upstream URLs kept without a manifest; `signingKey`/metadata preserved, 1439/1439 Keiyoushi entries decode exact.)
- [ ] Update each Mihon `repo.json` to point `index_v2` at the matching mirror `index.pb`; verify the generated Protobuf is accepted by Mihon. (Code done 2026-10-19 in `e3b5b50`: `rewriteMirroredIndexFiles` points `index_v2` at the mirror `index.pb`, covered by the `rewrites mirrored repo index_v2` test. In-app Mihon acceptance still open.)
- [x] Route website APK/JAR buttons to the new Releases and keep JARs in the website's asset manifest; the Mihon app index contains APK URLs. (Done 2026-10-19 in `e3b5b50`: buttons route to manifest/pinned release URLs; JARs kept in the website manifest only — the protobuf schema carries no `jarUrl`.)
- [x] Ensure the remaining Aniyomi index entries resolve to the release URLs without relying on hosted APK directories; Kohi-den must not appear in the current index. (Done 2026-10-19 in `e3b5b50`: flat Aniyomi entries synthesize pinned raw URLs, manifest wins when covered; Kohi-den absent from catalogs and code.)
- [x] Test direct downloads for representative Mihon and Aniyomi extensions, including one source with no JAR if applicable. (Done manually 2026-10-19: sample APK/JAR downloads return 206 with correct content-types across Mihon + Aniyomi incl. JAR-less sources. No automated download test in the suite by decision — live downloads are network-flaky.)

**Gate:** Website buttons and Mihon app clients resolve APKs to immutable Releases; generated Mihon indexes decode in Mihon and retain the original APK signing keys; no website link points at a removed hosted binary path.

### Phase 5 — Remove the artifact cache and binary host sync

- [x] Remove cache task commands and cache-specific orchestration from `scripts/task.ts` and `package.json`. (Done 2026-10-19: `cache:restore`/`cache:save` commands, `useCache` branches, and the `prepare-dist` restore step removed; `scripts/sync.ts` `--use-cache`/`--restore-cache-only` flags removed.)
- [x] Delete `scripts/cache.ts`, `scripts/cache/`, and cache-only tests after callers and coverage are updated. (Done 2026-10-19: 8 module files plus 7 test files deleted: `cache-*.test.ts` + `archive.test.ts`.)
- [x] Remove the S3/R2 cache dependency, cache environment variables, cache-related README instructions, and cache-only workflow settings. (Done 2026-10-19: `@bradenmacdonald/s3-lite-client` + `tar` deps removed; `S3_*` env removed from `update.yml` and `.env.example`; README had no cache references; pnpm store `cache: pnpm` kept.)
- [x] Keep any required site deployment (including DUFS/rclone if still used), but ensure it transfers only the binary-free site/catalog output. Remove any obsolete GitLab mirror step only if its purpose has ended. (Done 2026-10-19: DUFS `sync-to-dufs` kept, transfers gated binary-free `dist/` only; GitLab `sync-to-gitlab` kept — git-only mirror, purpose still unverified.)
- [x] Remove remaining cache and binary-materialization references from active scripts, workflows, docs, and tests. (Done 2026-10-19: stale comments, generic log strings, and one test name cleaned; remaining `cache` mentions are pnpm store caching, in-memory memoization, and one historical comment.)

**Gate:** No active command or workflow restores/saves the R2 cache or uploads APK/JAR files to hosted deployments.

### Phase 6 — Bootstrap, cut over, and verify

- [ ] Recount the pinned source inventory, then bootstrap the current APKs and available Mihon JARs from the four retained sources across at least four releases (current estimate: 3,144 binaries). Keep each release to at most 999 binaries plus its manifest; exclude Kohi-den. Switch catalog links only after all batches and URLs are verified.
- [ ] Deploy the release-backed catalog and site, then verify all current domains and existing repository index URLs.
- [x] Keep previously hosted binaries during the verification window; remove them only after release links and client compatibility are confirmed. (Moot 2026-10-19: no hosted APK/JARs have shipped since Phase 3 — nothing to keep or remove. The verification-window concept still applies to link cutover.)
- [x] Add tests for artifact discovery across the four retained sources, Kohi-den exclusion, checksum comparison, immutable/idempotent release planning, manifest URL generation, unchanged-run behavior, and binary-free `dist/` output. (Done 2026-10-19 in `d231e7d`: Kohi-den exclusion was the last gap — all 7 items covered, 55 tests pass. No live-network download tests by decision.)
- [ ] Run the existing checks (`pnpm test`, `pnpm check`, `pnpm lint`, and production build) and record results in the PR.
- [ ] Update these phase checkboxes and the PR checklist as each phase is completed.

**Gate:** Exactly four sources (two Mihon, two Aniyomi) remain advertised; Kohi-den is absent from current catalogs and is not polled or republished. Secozzi's selected index exposes the intended three APKs. Website buttons and Mihon app clients use GitHub Release APK URLs; generated Mihon indexes retain the upstream APK signing keys. Hosted output contains no APK/JAR files; no release exceeds 1,000 assets; repeated publishing of unchanged sources is a no-op.

## Risks and decisions to resolve

- **Mihon index integrity:** The mirror may regenerate `index.pb` with Release URLs without the upstream private key, but must preserve the source store's APK `signingKey` and mirror APK bytes exactly. Mihon rejects APKs whose signatures do not match that key. Encoder implemented (`scripts/generate-index.ts` + `scripts/extensionstore.proto`); hermetic decode-proof done (1439/1439 real Keiyoushi entries round-trip exact). In-app Mihon acceptance of a regenerated `index.pb` is still required before cutover.
- **Source differences:** The four retained sources differ in artifact URL shape and JAR availability. Layouts validated 2026-10-19 against pinned refs (Keiyoushi/Cursed: release-download APK+JAR URLs; Secozzi: release-download APKs, no JAR; Anime: `apk/` git-tree, no JAR); skip JARs that are not offered rather than inventing URLs. Kohi-den is retired and must not be fetched from the owner's Forgejo mirror.
- **Secozzi index path:** Resolved and implemented in Phase 3 — the configured `index.min.json` was a stale placeholder; `index.json` and `release-assets.json` contain the three active APKs. The catalog parser targets `/secozzi/index.json` with wrapper parsing, keeping the Aniyomi category.
- **Publish/deploy ordering:** Render, Workers, and the VPS may deploy on independent triggers. Rule decided 2026-10-19: the release publisher runs first; `.github/workflows/update.yml` now waits for the publisher's successful `workflow_run` and checks out that run's `head_sha`. Later site/catalog builds must fetch the manifest from GitHub Releases, never from `main`, and must not advertise release assets before GitHub has published them.
- **Release asset cap:** The current inventory estimate is 3,144 binaries, so the initial import cannot fit in one release; plan at least four bootstrap releases, with at most 999 binaries plus one manifest each, and recount before publishing.
- **Release history:** Historical assets remain available. Current catalog entries should point to each asset's immutable release URL, not a mutable `latest` URL.
- **Cutover safety:** Do not remove hosted APK/JAR files until the initial release and all generated URLs have been verified.
- **Schedule:** Forgejo will check every four hours using `0 */4 * * *` UTC.
