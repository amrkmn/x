# GitHub Releases artifact mirror overhaul

## Tracking status

This PR starts as a plan-only change and will track the implementation. Keep the phase checkboxes here and the high-level checklist in the PR description in sync as work lands.

- [ ] Phase 0 — Confirm publishing and catalog contracts
- [ ] Phase 1 — Move scheduled update checks to Forgejo
- [ ] Phase 2 — Publish immutable GitHub Releases
- [ ] Phase 3 — Keep hosted catalogs and site data lightweight
- [ ] Phase 4 — Update download links and preserve repository endpoints
- [ ] Phase 5 — Remove the artifact cache and binary host sync
- [ ] Phase 6 — Bootstrap, cut over, and verify

## Confirmed scope

- Keep the Mihon/Aniyomi website and its lightweight catalog, search data, indexes, and other required small files on the existing hosted sites.
- Retire Kohi-den: its original upstream has stopped, and its current mirror is served from the owner's Forgejo instance. Keep the other four sources (two Mihon and two Aniyomi).
- Publish APKs and available Mihon JARs as GitHub Release assets in the existing `amrkmn/x` repository; do not create a second artifact repository.
- Use immutable releases and upload only new or changed binary artifacts. Retain prior release assets.
- Use the Forgejo runner for the scheduled upstream check. It commits changes to `extensions.json` and mirrors them to GitHub.
- Use GitHub Actions for release publication, triggered by a `main` push that changes `extensions.json`.
- Remove the R2/S3 artifact cache and stop sending APK/JAR files to Cloudflare Workers, Render, or the VPS/DUFS deployment.
- This initial change is documentation only. Do not start implementation until the plan is reviewed.

The exact Forgejo cron expression and timezone have not been chosen; do not carry over the current GitHub Actions schedule by default.

## Current implementation

- `extensions.json` currently contains two Mihon and three Aniyomi sources, including Kohi-den via the owner's Forgejo mirror; the target configuration removes Kohi-den.
- `.github/workflows/update.yml` currently schedules `pnpm run update:check`, commits `extensions.json`, mirrors to GitLab, and can build/sync the site to DUFS.
- `scripts/extensions.ts` downloads source repository contents into `static/`, including index files, icons, APKs, and JARs; it also generates the website's catalog and search data.
- `scripts/task.ts`, `scripts/cache.ts`, and `scripts/cache/` implement the S3-compatible cache used to avoid re-materializing those files.
- The frontend prefers `apkUrl`/`jarUrl` but can fall back to paths under a hosted repository URL (`src/lib/components/ExtensionRow.svelte`).
- The local Keiyoushi artifact-repository example uses release URLs in its catalog and a `release-assets.json` index containing asset names and SHA-256 values. Use it as a reference, not as an assumption that all four retained sources expose artifacts identically.

## Current artifact estimate

Inventory of the current/latest artifact set at the source commits currently pinned in `extensions.json` (excluding retired Kohi-den):

| Source        | Pinned ref |      APKs |      JARs | Total files |
| ------------- | ---------- | --------: | --------: | ----------: |
| Keiyoushi     | `db80c78`  |     1,439 |     1,439 |       2,878 |
| Yuzono Cursed | `692d2a7`  |         6 |         6 |          12 |
| Secozzi       | `c6459f1`  |         3 |         0 |           3 |
| Yuzono Anime  | `d4fac05`  |       251 |         0 |         251 |
| **Total**     |            | **1,699** | **1,445** |   **3,144** |

These are current versions only, not all historical upstream releases, and count each source artifact separately without cross-source hash deduplication. Recount from the pinned source indexes immediately before the bootstrap.

**Secozzi index discrepancy:** `extensions.json` currently selects `/secozzi/index.min.json`, which contains one outdated Animiru placeholder. At the same pinned ref, `index.json` and `release-assets.json` list three current APKs (Jellyfin, Stremio, Torbox). Resolve the correct catalog path or artifact-discovery source in Phase 0; do not silently treat the placeholder as those three artifacts.

## Target flow

1. **Forgejo checks upstreams.** First remove Kohi-den from `extensions.json`; its original upstream has stopped, so do not poll or republish the owner's Forgejo mirror. The scheduled runner then checks the four retained sources, changes only their source commit values, and commits only when values changed. Forgejo's GitHub mirror push is the event that starts the GitHub workflow.
2. **GitHub publishes binaries.** A workflow on `main` runs only when `extensions.json` changes. It reads the updated source indexes, finds the current APKs and available Mihon JARs, hashes them, and compares them with the last published asset manifest.
3. **GitHub creates immutable releases when binaries changed.** Upload only changed files; never replace an asset in an existing release. Include a full current `release-assets.json` snapshot with each release. The snapshot maps source/package/artifact kind to version, filename, SHA-256, and the immutable release URL. Keep the manifest in release assets rather than committing generated state back to `main`, so GitHub does not diverge from Forgejo's mirrored branch. The initial bootstrap is split across at least four releases for the current 3,144-file inventory, with no more than 999 binaries plus one manifest per release. Do not publish the catalog until all bootstrap releases are complete.
4. **Catalog/site deployment follows publication.** Generate or refresh the lightweight site catalog and search data using the immutable URLs from the current asset manifest. Publish required repository indexes and site files only after their referenced release assets exist.
5. **Hosted endpoints remain binary-free.** Continue serving the web UI and required small catalog/index/icon files at the existing domains and paths. No APK or JAR should be present in the hosted build output or sent to DUFS, Workers, or Render.

If a run changes source metadata but produces no changed APK/JAR bytes, it should update any needed lightweight catalog/site data without creating an empty binary release.

## Implementation plan

### Phase 0 — Confirm publishing and catalog contracts

- [ ] Inventory APK and JAR metadata/URLs for the four retained sources, including sources not backed by a GitHub repository; exclude Kohi-den.
- [ ] Resolve the Secozzi index mismatch: its configured `index.min.json` has one obsolete placeholder, while `index.json` and `release-assets.json` identify three APKs. Decide which index path represents the source to mirror.
- [ ] Recount the current artifact set immediately before bootstrap and split it into releases with at most 999 binary assets plus one manifest each (GitHub allows 1,000 assets per release).
- [ ] Define an artifact identity and compare by SHA-256, with package/source and artifact kind as the stable key; preserve version/version-code fields for display.
- [ ] Choose a deterministic, unique release tag derived from the triggering update commit or source revisions. Define rerun behavior: verify-and-skip an existing matching release; fail on a conflicting tag or checksum; never overwrite existing assets.
- [ ] Define collision-safe release asset names and the exact `release-assets.json` schema. The manifest in each new release must describe the complete current set, retaining URLs for unchanged assets from older releases.
- [ ] Verify which hosted deployments are automatic on GitHub pushes and how they will be ordered after release publication. Keep site deployments that are still needed; remove only binary transfer/cache responsibilities.
- [ ] Determine whether any configured source can update without a binary change and ensure that catalog-only updates still deploy correctly.

**Gate:** The release publisher can build a complete current asset manifest, identify exactly which APK/JAR bytes are new without modifying GitHub's mirrored branch, and produce bootstrap batches that stay within the per-release asset cap.

### Phase 1 — Move scheduled update checks to Forgejo

- [ ] Configure the Forgejo runner schedule with an explicit cron expression and timezone.
- [ ] Remove Kohi-den from `extensions.json` and stop checking its owner's Forgejo mirror; the original upstream has stopped.
- [ ] Reuse or adapt the existing `update:check` behavior to compare refs for the four retained sources and update only `extensions.json`.
- [ ] Commit only `extensions.json` when source commit values change; configure the Forgejo mirror to push that commit to GitHub `main`.
- [ ] Remove the scheduled update-check and update-commit responsibility from `.github/workflows/update.yml`.
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
- [ ] Keep the four retained source entries; remove Kohi-den from generated catalogs and stop serving its current index endpoint. Resolve the Secozzi `repo.path` discrepancy rather than preserving a stale path blindly. Ensure source removals/renames are deliberate rather than cache-restore side effects.
- [ ] Verify the generated `dist/` has no `.apk` or `.jar` files while it still contains every required catalog, search, index, and site file.

**Gate:** The hosted site builds and retains all existing catalog/search/repository paths without materializing binary artifacts.

### Phase 4 — Update download links and preserve repository endpoints

- [ ] Make website APK and Mihon JAR links resolve to explicit immutable URLs from `release-assets.json`; remove fallback links to hosted `/apk/` or `/jar/` paths.
- [ ] Preserve the existing Add Repo / Copy Index URL behavior, mirror selector, and hosted repository paths.
- [ ] Verify the Mihon `index.pb` and `repo.json` behavior before changing their contents. The current code rewrites JSON metadata but serves the protobuf index to Mihon clients; do not rewrite a signed index unless a valid signing/regeneration path is available.
- [ ] Ensure the remaining Aniyomi index entries resolve to the release URLs without relying on hosted APK directories; Kohi-den must not appear in the current index.
- [ ] Test direct downloads for representative Mihon and Aniyomi extensions, including one source with no JAR if applicable.

**Gate:** Website downloads and app repository clients have documented, verified URL behavior; no advertised download points at a removed hosted binary path.

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

**Gate:** Exactly four sources (two Mihon, two Aniyomi) remain advertised; Kohi-den is absent from current catalogs and is not polled or republished. Secozzi's selected index exposes the intended three APKs. All advertised APK/JAR URLs resolve to GitHub Releases; hosted output contains no APK/JAR files; no release exceeds 1,000 assets; repeated publishing of unchanged sources is a no-op.

## Risks and decisions to resolve

- **Mihon protobuf/signing:** `repo.json` currently advertises `index.pb`. Verify whether its download URLs can be changed without the signing key and whether Mihon accepts the intended index. If not, preserve the upstream signed index and explicitly document that app-client downloads may remain upstream; do not make the site appear to provide a mirrored app repository when it does not.
- **Source differences:** The four retained sources may differ in artifact URL shape and JAR availability. Validate each source before standardizing the fetcher; skip JARs that are not offered rather than inventing URLs. Kohi-den is retired and must not be fetched from the owner's Forgejo mirror.
- **Secozzi index path:** The configured `index.min.json` contains one obsolete placeholder, while `index.json` and `release-assets.json` contain three active APKs. Resolve this before implementing the fetcher or changing hosted catalog paths.
- **Publish/deploy ordering:** Render, Workers, and the VPS may deploy on independent triggers. Ensure catalogs cannot advertise release assets before GitHub has published them.
- **Release asset cap:** The current inventory estimate is 3,144 binaries, so the initial import cannot fit in one release; plan at least four bootstrap releases, with at most 999 binaries plus one manifest each, and recount before publishing.
- **Release history:** Historical assets remain available. Current catalog entries should point to each asset's immutable release URL, not a mutable `latest` URL.
- **Cutover safety:** Do not remove hosted APK/JAR files until the initial release and all generated URLs have been verified.
- **Schedule:** The Forgejo cron/timezone is still to be chosen; the existing four-hour GitHub schedule is not an agreed target.
