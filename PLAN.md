# GitHub Releases artifact mirror overhaul

## Tracking status

This PR starts as a plan-only change and will track the implementation. Keep the phase checkboxes here and the high-level checklist in the PR description in sync as work lands.

- [x] Phase 0 — Confirm publishing and catalog contracts (done 2026-10-19; encoder decode-proof and final recount owned by Phase 4 / Phase 6 gates)
- [ ] Phase 1 — Move scheduled update checks to Forgejo
- [ ] Phase 2 — Publish immutable GitHub Releases
- [ ] Phase 3 — Keep hosted catalogs and site data lightweight
- [ ] Phase 4 — Update download links and preserve repository endpoints
- [ ] Phase 5 — Remove the artifact cache and binary host sync
- [ ] Phase 6 — Bootstrap, cut over, and verify

Progress 2026-10-19: Phase 0 complete (`f8e0a52`, `f21d151`, `9704cf2`). The encoder decode-proof runs with Phase 4 implementation; the final recount runs at bootstrap per Phase 6. Phase 1 in-repo work is done (Kohi-den removal, Forgejo check workflow, GitHub workflow trim); its gate waits on Forgejo-side sync, the first scheduled run, and mirror-push verification. No phase gate beyond Phase 0 is met yet.

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
- `.github/workflows/update.yml` no longer schedules, checks, or commits; on `main` pushes that touch `extensions.json` it mirrors to GitLab and syncs the site to DUFS.
- `scripts/extensions.ts` downloads source repository contents into `static/`, including index files, icons, APKs, and JARs; it also generates the website's catalog and search data.
- `scripts/task.ts`, `scripts/cache.ts`, and `scripts/cache/` implement the S3-compatible cache used to avoid re-materializing those files.
- The frontend prefers `apkUrl`/`jarUrl` but can fall back to paths under a hosted repository URL (`src/lib/components/ExtensionRow.svelte`).
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

**Secozzi index path (resolved 2026-10-19):** `extensions.json` still selects `/secozzi/index.min.json`, a stale single Animiru placeholder. The authoritative catalog is `index.json` (a `NetworkExtensionStore` wrapper) plus `release-assets.json`, listing three current APKs (Jellyfin, Stremio, Torbox) at the pinned ref. Implementation must set the source path to `/secozzi/index.json` and parse the wrapper without changing the Aniyomi category.

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
- [ ] Select and validate an encoder for regenerated per-source indexes; prove the generated bytes decode with Mihon's `NetworkExtensionStore` parser before cutover.
    - Selected: protobufjs with a `.proto` transcribed from `NetworkExtensionStore.kt` field numbers. Proof deferred to Phase 4 implementation (its gate requires Mihon acceptance). Gotchas confirmed against pinned indexes: JSON source `id`s are strings exceeding 2^53 (encode via string→int64, never JS number); proto `Resources` has no `jarUrl` (website-only); absent `homeUrl`/`mirrorUrls`/`discord` map to proto defaults; `contentWarning` uses `CONTENT_WARNING_*` names; `extensionListUrl` (102) is absent upstream (null).
- [x] Treat Secozzi's `index.json` and `release-assets.json` as authoritative for its three active APKs; the configured `index.min.json` is a stale legacy placeholder. Implementation must set the source path to `/secozzi/index.json` and parse its `NetworkExtensionStore` wrapper without changing the Aniyomi category.
- [ ] Recount the current artifact set immediately before bootstrap and split it into releases with at most 999 binary assets plus one manifest each (GitHub allows 1,000 assets per release). Preliminary recount 2026-10-19 at pinned refs: 3,144 binaries (1,699 APK + 1,445 JAR); must re-run immediately before bootstrap as pins may move.
- [x] Define an artifact identity and compare by SHA-256, with package/source and artifact kind as the stable key; preserve version/version-code fields for display.
- [x] Choose a deterministic, unique release tag derived from the triggering update commit or source revisions. Tag format `<shortSHA>-<n>` where shortSHA is the triggering `extensions.json` commit and n is the batch sequence within that commit. Rerun behavior: verify-and-skip an existing matching release; fail on a conflicting tag or checksum; never overwrite existing assets.
- [x] Define collision-safe release asset names and the exact `release-assets.json` schema. Asset files are source-prefixed (`<sourcekey>-<upstream-name>`). Schema extends the upstream shape (`pkg -> {apk:{name,sha256}, jar:{name,sha256}}`) with version, source, kind, and immutable release URL per artifact. The manifest in each new release must describe the complete current set, retaining URLs for unchanged assets from older releases.
- [x] Verify which hosted deployments are automatic on GitHub pushes and how they will be ordered after release publication. Findings 2026-10-19: Render static site builds `dist` from `main` (auto-deploy per dashboard — confirm); DUFS sync is the `sync-to-dufs` workflow job; Workers (`wrangler.toml` assets) has no in-repo deploy workflow (manual/external); GitLab mirror purpose unverified (possibly legacy). Ordering rule: the release publisher runs first on `extensions.json` changes; site deployments trigger only after referenced release assets exist, and site builds fetch the current manifest from GitHub Releases, never from `main`. Keep site deployments that are still needed; remove only binary transfer/cache responsibilities.
- [x] Determine whether any configured source can update without a binary change and ensure that catalog-only updates still deploy correctly. Yes: upstream revisions can change metadata with byte-identical APK/JARs. The publisher then creates no release but must still trigger a lightweight site/catalog refresh.

**Gate:** The release publisher can build a complete current asset manifest, identify exactly which APK/JAR bytes are new without modifying GitHub's mirrored branch, and produce bootstrap batches that stay within the per-release asset cap.

### Phase 1 — Move scheduled update checks to Forgejo

- [x] Configure the Forgejo runner schedule as `0 */4 * * *` UTC. (Declared 2026-10-19 in `.forgejo/workflows/check.yml`; takes effect once the Forgejo repo syncs this branch. The `.github/` sync jobs are guarded to GitHub only, since Forgejo evaluates both workflow directories.)
- [x] Remove Kohi-den from `extensions.json` and stop checking its owner's Forgejo mirror; the original upstream has stopped. (Done 2026-10-19; four sources remain. Only favicon/robots/sitemap are tracked under `static/`, so no generated files needed committing.)
- [x] Reuse or adapt the existing `update:check` behavior to compare refs for the four retained sources and update only `extensions.json`. (No code change needed 2026-10-19: quick mode compares remote heads and writes only `extensions.json`; Kohi-den removal leaves exactly the four retained sources.)
    - Runner procedure is encoded in `.forgejo/workflows/check.yml` (`0 */4 * * *` UTC + manual dispatch): fresh checkout; `pnpm ci`; `pnpm run update:check`; `pnpm run format`; if the `updated` output is not `true` then stop, else commit just `extensions.json` and push through the Forgejo→GitHub mirror. Never run materialization or commit anything else on the runner. Pre-condition: sync the Forgejo repo with GitHub `main` first (Kohi-den removal, both workflow changes), or the runner works from stale config.
- [ ] Commit only `extensions.json` when source commit values change; configure the Forgejo mirror to push that commit to GitHub `main`.
    - Sync topology (each direction has exactly one writer): pin commits originate only on Forgejo and reach GitHub via the Forgejo push-mirror; everything else flows GitHub→Forgejo via `.github/workflows/mirror.yml` (all `main` pushes, all branches fast-forward-only, secret `FORGEJO_MIRROR_URL`). The Forgejo repo must be a regular repo (never a pull-mirror, or scheduled syncs would clobber workflow commits), default branch `main`, Actions enabled. Merge this plan branch to `main` first — the Forgejo schedule cannot see `check.yml` until the merge has synced across.
- [x] Remove the scheduled update-check and update-commit responsibility from `.github/workflows/update.yml`. (Done 2026-10-19: schedule trigger and check/format/commit steps removed; `push` is paths-filtered to `extensions.json`; permissions dropped to `contents: read`; DUFS gate preserved via a `setup` job. GitHub no longer commits, so the mirror cannot diverge.)
- [ ] Verify a real Forgejo mirror push produces a GitHub `push` event; do not have the release workflow commit generated state back to `main`.

**Gate:** An upstream revision change produces one Forgejo commit limited to `extensions.json` and starts the intended GitHub workflow; an unchanged check produces no commit or release run.

### Phase 2 — Publish immutable GitHub Releases

- [ ] Add a GitHub Actions workflow filtered to `main` and `paths: [extensions.json]`, with manual dispatch only as a recovery option.
- [ ] Grant only the permissions needed to create releases and upload assets; serialize publication runs for `main`.
- [ ] Fetch current source indexes for the four retained sources and resolve each listed APK and available Mihon JAR. Do not fetch or publish Kohi-den artifacts. Handle each source's actual index layout rather than assuming one shared URL/schema.
- [ ] Download candidate assets, reject missing/empty or ambiguous files, compute SHA-256, and compare against the prior full release manifest.
- [ ] Create a deterministic immutable release only when binary bytes changed. Upload changed APK/JAR assets plus a complete current `release-assets.json`; reuse prior immutable URLs for unchanged bytes.
- [ ] Preserve historical releases when an extension is removed or superseded. Remove it from the current manifest only after confirming it is no longer advertised by its source.
- [ ] Make reruns idempotent: an existing release with matching hashes is accepted without re-upload; mismatches fail visibly.

**Gate:** Each release stays within GitHub's 1,000-asset cap; the first run can bootstrap the complete current inventory across the planned batches; a second run over identical bytes creates no new binary release or assets, and no existing release asset is overwritten.

### Phase 3 — Keep hosted catalogs and site data lightweight

- [ ] Refactor the source materialization in `scripts/extensions.ts` so index/catalog refreshes do not copy APKs or JARs into `static/`.
- [ ] Update `scripts/config.ts` and source fetch logic to retain only the index, repository metadata, and supporting small files required by the site and app repository endpoints.
- [ ] Generate the website's `static/data.json` and `static/indexes.json` from current source metadata and the complete release asset manifest.
- [ ] Keep the four retained source entries; remove Kohi-den from generated catalogs and stop serving its current index endpoint. Point Secozzi at `/secozzi/index.json` and parse its wrapper without changing its Aniyomi category. Ensure source removals/renames are deliberate rather than cache-restore side effects.
- [ ] Verify the generated `dist/` has no `.apk` or `.jar` files while it still contains every required catalog, search, index, and site file.

**Gate:** The hosted site builds and retains all existing catalog/search/repository paths without materializing binary artifacts.

### Phase 4 — Update download links and preserve repository endpoints

- [ ] Make website APK and Mihon JAR links resolve to explicit immutable URLs from `release-assets.json`; remove fallback links to hosted `/apk/` or `/jar/` paths.
- [ ] Preserve the existing Add Repo / Copy Index URL behavior, mirror selector, and hosted repository paths.
- [ ] Generate a mirror-owned Mihon `index.pb` per Mihon source with `resources.apkUrl` values pointing to immutable Release URLs; preserve the source `signingKey`, extension metadata, and APK bytes.
- [ ] Update each Mihon `repo.json` to point `index_v2` at the matching mirror `index.pb`; verify the generated Protobuf is accepted by Mihon.
- [ ] Route website APK/JAR buttons to the new Releases and keep JARs in the website's asset manifest; the Mihon app index contains APK URLs.
- [ ] Ensure the remaining Aniyomi index entries resolve to the release URLs without relying on hosted APK directories; Kohi-den must not appear in the current index.
- [ ] Test direct downloads for representative Mihon and Aniyomi extensions, including one source with no JAR if applicable.

**Gate:** Website buttons and Mihon app clients resolve APKs to immutable Releases; generated Mihon indexes decode in Mihon and retain the original APK signing keys; no website link points at a removed hosted binary path.

### Phase 5 — Remove the artifact cache and binary host sync

- [ ] Remove cache task commands and cache-specific orchestration from `scripts/task.ts` and `package.json`.
- [ ] Delete `scripts/cache.ts`, `scripts/cache/`, and cache-only tests after callers and coverage are updated.
- [ ] Remove the S3/R2 cache dependency, cache environment variables, cache-related README instructions, and cache-only workflow settings.
- [ ] Keep any required site deployment (including DUFS/rclone if still used), but ensure it transfers only the binary-free site/catalog output. Remove any obsolete GitLab mirror step only if its purpose has ended.
- [ ] Remove remaining cache and binary-materialization references from active scripts, workflows, docs, and tests.

**Gate:** No active command or workflow restores/saves the R2 cache or uploads APK/JAR files to hosted deployments.

### Phase 6 — Bootstrap, cut over, and verify

- [ ] Recount the pinned source inventory, then bootstrap the current APKs and available Mihon JARs from the four retained sources across at least four releases (current estimate: 3,144 binaries). Keep each release to at most 999 binaries plus its manifest; exclude Kohi-den. Switch catalog links only after all batches and URLs are verified.
- [ ] Deploy the release-backed catalog and site, then verify all current domains and existing repository index URLs.
- [ ] Keep previously hosted binaries during the verification window; remove them only after release links and client compatibility are confirmed.
- [ ] Add tests for artifact discovery across the four retained sources, Kohi-den exclusion, checksum comparison, immutable/idempotent release planning, manifest URL generation, unchanged-run behavior, and binary-free `dist/` output.
- [ ] Run the existing checks (`pnpm test`, `pnpm check`, `pnpm lint`, and production build) and record results in the PR.
- [ ] Update these phase checkboxes and the PR checklist as each phase is completed.

**Gate:** Exactly four sources (two Mihon, two Aniyomi) remain advertised; Kohi-den is absent from current catalogs and is not polled or republished. Secozzi's selected index exposes the intended three APKs. Website buttons and Mihon app clients use GitHub Release APK URLs; generated Mihon indexes retain the upstream APK signing keys. Hosted output contains no APK/JAR files; no release exceeds 1,000 assets; repeated publishing of unchanged sources is a no-op.

## Risks and decisions to resolve

- **Mihon index integrity:** The mirror may regenerate `index.pb` with Release URLs without the upstream private key, but must preserve the source store's APK `signingKey` and mirror APK bytes exactly. Mihon rejects APKs whose signatures do not match that key. Encoder selected (protobufjs, schema transcribed from `NetworkExtensionStore.kt`); the executable decode-proof is still required before cutover.
- **Source differences:** The four retained sources differ in artifact URL shape and JAR availability. Layouts validated 2026-10-19 against pinned refs (Keiyoushi/Cursed: release-download APK+JAR URLs; Secozzi: release-download APKs, no JAR; Anime: `apk/` git-tree, no JAR); skip JARs that are not offered rather than inventing URLs. Kohi-den is retired and must not be fetched from the owner's Forgejo mirror.
- **Secozzi index path:** Resolved 2026-10-19 — the configured `index.min.json` is a stale placeholder; `index.json` and `release-assets.json` contain the three active APKs. Use the latter data and update the catalog parser/path, keeping the Aniyomi category.
- **Publish/deploy ordering:** Render, Workers, and the VPS may deploy on independent triggers. Rule decided 2026-10-19: the release publisher runs first; site deployments trigger only after referenced release assets exist, and site builds fetch the manifest from GitHub Releases, never from `main`. Catalogs must not advertise release assets before GitHub has published them.
- **Release asset cap:** The current inventory estimate is 3,144 binaries, so the initial import cannot fit in one release; plan at least four bootstrap releases, with at most 999 binaries plus one manifest each, and recount before publishing.
- **Release history:** Historical assets remain available. Current catalog entries should point to each asset's immutable release URL, not a mutable `latest` URL.
- **Cutover safety:** Do not remove hosted APK/JAR files until the initial release and all generated URLs have been verified.
- **Schedule:** Forgejo will check every four hours using `0 */4 * * *` UTC.
