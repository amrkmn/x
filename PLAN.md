# GitHub Releases artifact mirror overhaul

## Tracking status

This PR starts as a plan-only change and will track the implementation. Keep the phase checkboxes here and the high-level checklist in the PR description in sync as work lands.

- [ ] Phase 0 — Confirm publishing and catalog contracts (original contracts confirmed; host/redirect ordering reopened 2026-10-20 and tracked with Phase 4–6 verification)
- [ ] Phase 1 — Run scheduled update checks on GitHub
- [x] Phase 2 — Publish immutable GitHub Releases (done: bootstrap `7d24c19-0..3` published 2026-10-19, unchanged-rerun no-op proven in run 39256694105, live publisher runs green since)
- [x] Phase 3 — Keep hosted catalogs and site data lightweight (done 2026-10-19: all items checked, binary-free `dist` with complete catalogs verified locally and on every gated deploy since)
- [ ] Phase 4 — Update download links and preserve repository endpoints
- [x] Phase 5 — Remove the artifact cache and retire DUFS/Pages deployment (done 2026-10-20: cache removal `965b5bb`; host retirement wired + verified live on all three hosts, run `39420320258`; `x.amar.kim` DNS cut to Netlify + cert active, verified identical bytes)
- [ ] Phase 6 — Bootstrap, cut over, and verify

Progress 2026-10-19: Phase 0 complete (`f8e0a52`, `f21d151`, `9704cf2`). The encoder decode-proof runs with Phase 4 implementation; the final recount runs at bootstrap per Phase 6. Phase 1 in-repo work is done (Kohi-den removal, GitHub check workflow, and GitHub workflow trim); its remaining gate is to prove that an update commit from `check.yml` starts `publish.yml` and the downstream site workflow. Forgejo setup is canceled and is not part of the target topology. Phase 2 publisher code, tests, and workflow are implemented on `plan/github-release-artifacts`; no live release has been created. Phase 2's gate remains open until the merged GitHub workflow is exercised end to end. Phase 3 lightweight-catalog code is implemented on `plan/github-release-artifacts` (no APK/JAR materialization, Secozzi wrapper parsing, binary pruning, optional manifest overlay); verified locally with 82 tests, `pnpm check`/`lint`, and a `prepare-dist` run producing a binary-free `dist/` with complete catalogs (1,699 records across the four sources). No download-link cutover: entries keep upstream URLs until the publisher produces a manifest (Phase 4). (Counts superseded: 54 tests as of Phase 5 after cache-test removal; catalog re-verified binary-free during Phase 5 validation — entry totals move with upstream pins.)

## Confirmed scope

- Keep the Mihon/Aniyomi website and its lightweight catalog, search data, indexes, redirects, and other required small files static on Cloudflare Workers and Netlify.
- Retire Kohi-den: its original upstream has stopped; do not poll or republish its archived owner-maintained mirror. Keep the other four sources (two Mihon and two Aniyomi).
- Publish APKs and available Mihon JARs as GitHub Release assets in the existing `amrkmn/x` repository; do not create a second artifact repository.
- Use immutable releases and upload only new or changed binary artifacts. Retain prior release assets.
- Use GitHub Actions to check upstreams on the confirmed schedule `0 */4 * * *` UTC. When pins change, commit only `extensions.json` to `main` and reliably trigger release publication.
- Use GitHub Actions for release publication after pin updates, normally via a `main` push changing `extensions.json`; retain manual dispatch for recovery.
- Generate mirror-owned protobuf indexes with source-specific wire schemas. Mihon sources use Mihon's `index.pb` format and preserve the source `signingKey` and original APK bytes. Secozzi remains Aniyomi, uses upstream `index.json` as input, and is publicly served as `/secozzi/index.pb` using Aniyomi's wire format.
- Keep hosted output binary-free. Use static redirects to immutable GitHub Release URLs for legacy APK paths; do not copy APK/JAR bytes to hosts. Retire DUFS and the unused Pages-branch deployment.
- The PR began as plan-only; implementation changes will follow the reviewed phases and stay tracked in this PR.

## Current implementation

- `extensions.json` contains two Mihon and two Aniyomi sources; Kohi-den was removed in Phase 1. Secozzi's public endpoint is `/secozzi/index.pb`, generated from upstream `index.json` with the Aniyomi codec; Yuzono Anime's Aniyomi PB conversion and legacy `_redirects` remain open in Phase 4.
- Update checks run on GitHub (`.github/workflows/check.yml`, `0 */4 * * *` UTC + manual dispatch); Forgejo is not part of this pipeline. The check workflow now passes `secrets.GH_TOKEN` to checkout so pin-update pushes can start `publish.yml`; Phase 1 still requires confirming the secret is a non-default token and verifying the live workflow handoff.
- `.github/workflows/publish.yml` publishes changed binaries when `extensions.json` changes on `main`. `.github/workflows/update.yml` is a single `deploy` job gated on publisher success: manifest fetch (fail-closed) → `prepare-dist` → `wrangler deploy` → Netlify CLI `deploy --prod --dir dist`. DUFS/Pages jobs are retired. Git mirrors live in `.github/workflows/mirror.yml`: every `main` push is mirrored fast-forward-only to GitLab over SSH.
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

**Secozzi index paths:** The authoritative upstream input is `/secozzi/index.json` (a `NetworkExtensionStore` JSON wrapper) plus `release-assets.json`, listing three current APKs (Jellyfin, Stremio, Torbox) at the pinned ref. The public mirror endpoint is `/secozzi/index.pb`; keep the source categorized as Aniyomi and encode the output with Aniyomi's protobuf field numbers.

## Target flow

1. **GitHub checks upstreams.** Kohi-den is retired and excluded from `extensions.json`. On `0 */4 * * *` UTC, the GitHub Actions runner checks the four retained sources, changes only their source commit values, and commits only when values changed. The commit must trigger the publisher: `check.yml` passes `secrets.GH_TOKEN` to checkout, so Phase 1 must still confirm that secret is a non-default token and verify the live update → publish → deploy chain.
2. **GitHub publishes binaries.** A workflow on `main` runs only when `extensions.json` changes. It reads the updated source indexes, finds the current APKs and available Mihon JARs, hashes them, and compares them with the last published asset manifest. It mirrors APK/JAR bytes without re-signing them.
3. **GitHub creates immutable releases when binaries changed.** Upload only changed files; never replace an asset in an existing release. Include a full current `release-assets.json` snapshot with each release. The snapshot maps source/package/artifact kind to version, filename, SHA-256, and the immutable release URL. Store the manifest in release assets rather than committing generated state to `main`; the publisher must not write generated state back to the source branch. The initial bootstrap is split across at least four releases for the current 3,144-file inventory, with no more than 999 binaries plus one manifest per release. Do not publish the catalog until all bootstrap releases are complete.
4. **Catalog/site deployment follows publication.** Generate or refresh the lightweight site catalog and search data using the immutable URLs from the current asset manifest. Generate Mihon `index.pb` files with Mihon's wire schema. Generate Aniyomi-compatible PB indexes for Secozzi and Yuzono Anime; for Yuzono Anime, convert legacy `index.min.json` fields and overlay each APK with its immutable Release URL. Generate `dist/_redirects` mapping legacy `/yuzono/anime/apk/<filename>` requests to the same Release URLs with explicit 302 status. Preserve signing keys and source metadata; deploy only after referenced release assets exist.

5. **Hosted endpoints remain binary-free.** Serve the web UI, catalogs, protobuf indexes, and generated `_redirects` from Cloudflare Workers Static Assets and Netlify. Do not store APK/JAR files on either host; redirects send legacy clients to immutable GitHub Release assets. DUFS and Pages deployment are retired.

If a run changes source metadata but produces no changed APK/JAR bytes, it should update any needed lightweight catalog/site data without creating an empty binary release.

## Implementation plan

### Phase 0 — Confirm publishing and catalog contracts

- [x] Inventory APK and JAR metadata/URLs for the four retained sources, including sources not backed by a GitHub repository; exclude Kohi-den. (Validated 2026-10-19 at pinned refs: Keiyoushi 1,439 APK + 1,439 JAR via release-download URLs; Yuzono Cursed 6 + 6; Secozzi 3 APK via wrapper `index.json`, 0 JAR; Yuzono Anime 251 APK under git-tree `apk/`, 0 JAR. Total 1,699 APK + 1,445 JAR = 3,144.)
- [x] Confirm from Mihon source that `index.pb` is Protobuf data, not a signed index; its `signingKey` field verifies APK signatures. Preserve each source key and the APK bytes unchanged, so no upstream private key is needed to rewrite APK URLs.
- [x] Select and validate the Mihon encoder for Mihon indexes; prove its generated bytes decode with Mihon's `NetworkExtensionStore` parser before cutover. (Done 2026-10-19: protobufjs with the Mihon `.proto`; hermetic proof 1439/1439 real Keiyoushi entries round-trip exact. In-app Mihon acceptance remains a Phase 4 gate.)
    - The Mihon codec is not the Secozzi codec. Mihon gotchas confirmed against pinned indexes: JSON source `id`s are strings exceeding 2^53 (encode via string→int64, never JS number); absent `homeUrl`/`mirrorUrls`/`discord` map to proto defaults; `contentWarning` uses `CONTENT_WARNING_*` names; `extensionListUrl` (102) is absent upstream (null). Secozzi's Aniyomi resource model has APK/icon fields only; keep JAR links in the website manifest, not its PB.
- [x] Treat Secozzi's upstream `index.json` and `release-assets.json` as authoritative for its three active APKs; the configured `index.min.json` is a stale legacy placeholder. Use `/secozzi/index.json` as the upstream input and `/secozzi/index.pb` as the public mirror endpoint; preserve the Aniyomi category. Aniyomi-compatible protobuf implementation and verification are tracked in Phase 4.
- [ ] Recount the current artifact set immediately before bootstrap and split it into releases with at most 999 binary assets plus one manifest each (GitHub allows 1,000 assets per release). Preliminary recount 2026-10-19 at pinned refs: 3,144 binaries (1,699 APK + 1,445 JAR); must re-run immediately before bootstrap as pins may move.
- [x] Define an artifact identity and compare by SHA-256, with package/source and artifact kind as the stable key; preserve version/version-code fields for display.
- [x] Confirm the Aniyomi wire contract from Animiru `NetworkExtensionStore.kt` (commit `0b9bb0a`) and Aniyomi `NetworkAnimeExtensionStore.kt` (commit `9741444`): extension `isTorrent` is field 8, `sources` is field 9, `Source.message` is field 6, and `Resources` uses APK/icon fields 1/2. Both consumers accept gzip-compressed protobuf and follow `repo.json.index_v2`.
- [x] Choose a deterministic, unique release tag derived from the triggering update commit or source revisions. Tag format `<shortSHA>-<n>` where shortSHA is the triggering `extensions.json` commit and n is the batch sequence within that commit. Rerun behavior: verify-and-skip an existing matching release; fail on a conflicting tag or checksum; never overwrite existing assets.
- [x] Define collision-safe release asset names and the exact `release-assets.json` schema. Asset files are source-prefixed (`<sourcekey>-<upstream-name>`, with `/` normalized to `-`). The manifest is nested `sourceKey -> packageName -> {apk?, jar?}`; each artifact record contains `name`, `sha256`, `version`, optional `versionCode`, `source`, `kind`, and immutable release `url`. Each new release carries the same complete current manifest, retaining URLs for unchanged assets from older releases.
- [x] Reconfigure and verify hosted deployment ordering. (Done 2026-10-20, superseding the Build-Hook plan: `.github/workflows/update.yml` runs only after publisher success, deploys `dist` to Workers with Wrangler and ships the same prebuilt `dist/` to Netlify with the CLI; independent production auto-deploys on `main` disabled on both hosts by disconnecting host-side repo connections; DUFS and Pages jobs retired; manifest fetch is fail-closed so catalogs and `_redirects` always use a complete release manifest.)
- [x] Determine whether any configured source can update without a binary change and ensure that catalog-only updates still deploy correctly. Yes: upstream revisions can change metadata with byte-identical APK/JARs. The publisher then creates no release but must still trigger a lightweight site/catalog refresh.

**Gate:** The release publisher can build a complete current asset manifest, identify exactly which APK/JAR bytes are new without committing generated state to `main`, and produce bootstrap batches that stay within the per-release asset cap.

### Phase 1 — Run scheduled update checks on GitHub

- [x] Configure the update-check schedule as `0 */4 * * *` UTC in `.github/workflows/check.yml`.
- [x] Remove Kohi-den from `extensions.json` and stop checking its retired upstream mirror. (Done 2026-10-19; four sources remain. Only favicon/robots/sitemap are tracked under `static/`, so no generated files needed committing.)
- [x] Reuse the existing `update:check` behavior to compare refs for the four retained sources and update only `extensions.json`. (Quick mode compares remote heads and writes only `extensions.json`.)
    - Runner procedure: fresh checkout; setup (pnpm + Node 24 + install via `pnpm/setup`, which refuses to update the lockfile in CI); `pnpm run update:check`; `pnpm run format`; if the `updated` output is not `true`, stop; otherwise commit only `extensions.json` and push to `main`. Never run materialization or commit anything else on the runner.
- [x] Commit only `extensions.json` when source commit values change. (`check.yml` stages only this file.)
- [ ] Ensure an automated pin-update commit starts `.github/workflows/publish.yml`. `check.yml` now passes `secrets.GH_TOKEN` to checkout; confirm that secret is a PAT/GitHub App token (GitHub suppresses follow-on runs for default-token pushes) and verify the live trigger chain without causing recursive runs.
- [x] Keep scheduled update-check and update-commit responsibility out of `.github/workflows/update.yml`. (The separate check workflow owns it; `update.yml` deploys only after the publisher workflow succeeds.)
- [ ] Verify an update that changes a pin commits only `extensions.json`, starts the publisher, and then starts the downstream site workflow. Verify an unchanged check creates no commit or publisher run.

**Gate:** A scheduled or manually dispatched check that finds an upstream revision change produces one commit limited to `extensions.json`, reliably starts release publication, and deploys only after successful publication. An unchanged check produces no commit, release, or deployment run.

> Owner decision 2026-10-20: Forgejo use is canceled. GitHub is the sole scheduled updater and source branch for this pipeline. Forgejo runner, mirror, repository setup, integration, and secret instructions are not part of the target topology. The remaining Phase 1 gate is the GitHub token/dispatch handoff above.

### Phase 2 — Publish immutable GitHub Releases

- [x] Add a GitHub Actions workflow filtered to `main` and `paths: [extensions.json]`, with manual dispatch only as a recovery option. (`workflow_dispatch` is recovery-only; the downstream site workflow runs on successful `workflow_run` so it cannot race release publication.)
- [x] Grant only the permissions needed to create releases and upload assets; serialize publication runs for `main`. (`contents: write`; one non-canceling `release-publisher-main` concurrency group.)
- [x] Fetch current source indexes for the four retained sources and resolve each listed APK and available Mihon JAR. Do not fetch or publish Kohi-den artifacts. Handle each source's actual index layout rather than assuming one shared URL/schema. (Uses the three wrapped `index.json` catalogs plus their upstream asset manifests, and Anime's flat `index.min.json` plus pinned `apk/` path.)
- [x] Download candidate assets, reject missing/empty or ambiguous files, compute SHA-256, and compare against the prior full release manifest. (Validates upstream checksums for the three sources with `release-assets.json`; Anime has no upstream checksum manifest.)
- [x] Create a deterministic immutable release only when binary bytes changed. Upload changed APK/JAR assets plus a complete current `release-assets.json`; reuse prior immutable URLs for unchanged bytes. (Stages drafts, verifies all asset names/digests, then publishes; no release for metadata-only changes.)
- [x] Preserve historical releases when an extension is removed or superseded. Remove it from the current manifest only after confirming it is no longer advertised by its source. (Only the newly generated current snapshot omits removed entries; prior releases/assets are untouched.)
- [x] Make reruns idempotent: an existing release with matching hashes is accepted without re-upload; mismatches fail visibly. (Matching partial drafts resume by adding only missing assets; published releases are verification-only.)

**Gate:** Each release stays within GitHub's 1,000-asset cap; the first run can bootstrap the complete current inventory across the planned batches; a second run over identical bytes creates no new binary release or assets, and no existing release asset is overwritten. The planner and fake-client tests cover these cases, and real pinned-index discovery found 3,144 artifacts; the bootstrap completed 2026-10-19 (releases `7d24c19-0..3` published: 1,000/1,000/1,000/148 assets, manifest in each; run locally after two CI attempts hit API abuse throttling, see PLAN Phase 6 notes). Three superseded `d3e1e85-*` drafts remain to be deleted (API DELETEs 502; use the web UI). The unchanged-rerun no-op check is proven: run 39256694105 completed `0 binaries, 0 releases` with ~2,900 checksum-skipped artifacts, so the phase gate is closed.

### Phase 3 — Keep hosted catalogs and site data lightweight

- [x] Refactor the source materialization in `scripts/extensions.ts` so index/catalog refreshes do not copy APKs or JARs into `static/`. (Done 2026-10-19: `filesToCopy` retains only index files, `repo.json`, and `icon`; `materializeExtensions` wipes and recopies from that list.)
- [x] Update `scripts/config.ts` and source fetch logic to retain only the index, repository metadata, and supporting small files required by the site and app repository endpoints. (Done 2026-10-19; sparse checkout follows the same list. Icons: `fetchMissingIcons` backfills wrapper-source icons (Keiyoushi/Cursed/Secozzi) from upstream `iconUrl` into `static/<key>/icon/` during materialization and on update runs; failures keep the upstream URL. Verified 2026-10-19: 1,439/1,439 Keiyoushi icons fetched with 0 failures, mirror rewrite to `x.noz.one` URLs confirmed. Anime carries no `iconUrl` and is skipped by construction; its branch-shipped icons serve the frontend `${repoUrl}/icon/` fallback.)
- [x] Generate the website's `static/data.json` and `static/indexes.json` from current source metadata and the complete release asset manifest. (Done 2026-10-19 as an optional overlay: `generateDataJson` accepts a `ReleaseManifest` or `RELEASE_MANIFEST_FILE`; manifest-covered packages resolve to immutable release URLs, everything else keeps upstream URLs. No manifest exists yet — the publisher is not live — so current output is metadata plus upstream URLs; catalog-only updates with no new release flow through unchanged.)
- [x] Keep the four retained source entries; remove Kohi-den from generated catalogs and stop serving its current index endpoint. Use Secozzi's upstream `/secozzi/index.json` as input and expose the public `/secozzi/index.pb` endpoint without changing its Aniyomi category. Ensure source removals/renames are deliberate rather than cache-restore side effects. (Done 2026-10-19: `loadRepoExtensions` maps the served `.pb` path to the upstream JSON wrapper; wrapper parsing is shape-aware and the sentinel follows the Aniyomi path basename. Local `prepare-dist` confirmed Kohi-den absent and Secozzi contributing its 3 wrapper entries as Aniyomi. Aniyomi-compatible PB generation is a Phase 4 item.)
- [x] Verify the generated `dist/` has no `.apk` or `.jar` files while it still contains every required catalog, search, index, and site file. (Done 2026-10-19 locally: `prepare-dist` fails the run when `findBinaryArtifacts('dist')` is non-empty; observed run produced 0 binaries with `data.json`, `indexes.json`, per-source `index.json`/`index.min.json`/`index.pb`/`repo.json`/`icon` intact. Netlify/Workers deployment and `_redirects` delivery are re-verified in Phase 6 after DUFS and Pages jobs are retired.)

**Gate:** The hosted site builds and retains all existing catalog/search/repository paths without materializing binary artifacts.

### Phase 4 — Update download links and preserve repository endpoints

- [x] Make website APK and Mihon JAR links resolve to explicit immutable URLs from `release-assets.json`; remove fallback links to hosted `/apk/` or `/jar/` paths. (Done 2026-10-19 in `e3b5b50`: `ExtensionRow` uses `apkUrl` directly, Jar iff `jarUrl`; hosted `/apk/`+`/jar/` fallbacks removed; no hosted binary links across 1,699 live entries.)
- [x] Preserve the existing Add Repo / Copy Index URL behavior, mirror selector, and hosted repository paths. (Done 2026-10-19 in `e3b5b50`: `MirrorSelector`, copy-URL in `ExtensionCard`, and hosted repository paths untouched.)
- [x] Generate a mirror-owned Mihon `index.pb` per Mihon source with `resources.apkUrl` values pointing to immutable Release URLs; preserve the source `signingKey`, extension metadata, and APK bytes. (Done 2026-10-19 in `e3b5b50`: `refreshMirrorIndexPb` regenerates Mihon indexes via `generate-index.ts` with manifest overlay — upstream URLs kept without a manifest; `signingKey`/metadata preserved, 1439/1439 Keiyoushi entries decode exact.)
- [x] Implement `encodeAniyomiIndexPb` in `scripts/generate-index.ts` using `scripts/proto/aniyomi/extensionstore.proto`; keep the Mihon schema at `scripts/proto/mihon/extensionstore.proto`. Select the Aniyomi codec for Secozzi's wrapped catalog in `scripts/extensions.ts`, never the Mihon codec. Match the consumer model: extension `isTorrent` field 8, `sources` field 9; `Source.message` field 6; `Resources.apkUrl`/`iconUrl` fields 1/2. Preserve the signing key, source IDs as int64, source messages, torrent flags, and release-overlaid APK URLs. Keep `repo.json:index_v2` pointing to the generated PB.
- [x] Add an independent wire-format test in `tests/generate-index.test.ts` that decodes generated gzip bytes against the Aniyomi contract and asserts all Secozzi fields, including `isTorrent`, source IDs/messages, and APK URL overlay.
- [x] Convert Yuzono Anime's flat `index.min.json` records into an Aniyomi `NetworkAnimeExtensionStore` PB. Preserve legacy behavior: strip the `Aniyomi: ` display prefix; map `pkg` to `packageName`, `apk` to the release-manifest APK URL, `version` to `versionName`, `code` to int64 `versionCode`, `nsfw` to `contentWarning`, `sources` to field-9 source records, and `baseUrl` to `homeUrl`; derive `extensionLib` with the legacy rule; use `isTorrent=false` and synthesize the legacy default source when the list is empty. Preserve `repo.json.meta.signingKeyFingerprint` and the mirrored icon URL; point `index_v2` to `/yuzono/anime/index.pb` only after generating it. (Done 2026-10-20: `flatAnimeToWrapper` in `scripts/generate-index.ts` + `refreshFlatAnimeIndexPb` in `scripts/extensions.ts`, wired through `refreshMirrorIndexPb`/`overlayReleaseManifest`/`materializeExtensions`; verified against all 251 pinned entries — upstream pinned URLs without a manifest, release URLs when covered. `index_v2` was already mirror-pointed by `rewriteMirroredIndexFiles`; generation now runs in the same materialize/overlay pass so the pointer is valid by deploy time.)
- [x] Generate `dist/_redirects` for legacy clients: map each current `/yuzono/anime/apk/<apk filename>` path from `index.min.json` to that package's immutable Release URL with explicit HTTP 302. Generate only from a complete manifest; fail closed if a current APK lacks a Release URL, and never copy APK bytes into the site. (Done 2026-10-20: `generateRedirects` writes `static/_redirects`, copied to `dist/` by the astro build for Workers Static Assets and Netlify; throws on any uncovered current APK, removes stale output without a manifest; `static/_redirects` gitignored. Wired into `prepare-dist` and `cutover` sharing one manifest snapshot.)
- [x] Add tests for Yuzono flat-index conversion, release APK URL mapping, and generated redirect rules; assert `index.min.json` remains available, `index.pb` decodes with Aniyomi fields, and every legacy APK route targets its matching Release asset. (Done 2026-10-20: 3 codec tests in `tests/generate-index.test.ts` incl. independent consumer-schema decode; 5 pipeline tests in `tests/update-pipeline.test.ts`.)

#### Automated Verification:

- [x] `pnpm test` — includes Aniyomi wire-format, Yuzono legacy conversion, and redirect-generation tests. (Done 2026-10-20: 73 passed.)
- [x] `pnpm check` — no type errors. (Done 2026-10-20: 0 errors; `pnpm lint` and `pnpm format` also clean.)

#### Manual Verification:

- [ ] Add Secozzi in Aniyomi and Animiru; confirm `/secozzi/index.pb` loads and all three entries retain their torrent/source metadata.
- [ ] In a legacy Aniyomi client, add Yuzono Anime and download a representative APK; confirm `/yuzono/anime/apk/<filename>` returns a redirect to the matching immutable Release asset.

- [ ] Update each Mihon `repo.json` to point `index_v2` at the matching mirror `index.pb`; verify the generated Protobuf is accepted by Mihon. (Code done 2026-10-19 in `e3b5b50`: `rewriteMirroredIndexFiles` points `index_v2` at the mirror `index.pb`, covered by the `rewrites mirrored repo index_v2` test. In-app Mihon acceptance still open.)
- [x] Route website APK/JAR buttons to the new Releases and keep JARs in the website's asset manifest; app indexes expose only fields supported by their respective wire schemas. (Done 2026-10-19 in `e3b5b50`: buttons route to manifest/pinned release URLs; JARs remain a website concern and are not part of Secozzi's Aniyomi resource schema.)
- [x] Ensure the remaining Aniyomi index entries resolve to the release URLs without relying on hosted APK directories; Kohi-den must not appear in the current index. (Done 2026-10-19 in `e3b5b50`: flat Aniyomi entries synthesize pinned raw URLs, manifest wins when covered; Kohi-den absent from catalogs and code.)
- [x] Test direct downloads for representative Mihon and Aniyomi extensions, including one source with no JAR if applicable. (Done manually 2026-10-19: sample APK/JAR downloads return 206 with correct content-types across Mihon + Aniyomi incl. JAR-less sources. No automated download test in the suite by decision — live downloads are network-flaky.)

**Gate:** Website buttons resolve APK/JARs to immutable Releases; generated Mihon indexes decode in Mihon; Secozzi and Yuzono Anime PB indexes decode in Aniyomi/Animiru with metadata intact; legacy Yuzono APK URLs redirect to immutable Release assets; no APK/JAR bytes are hosted.

### Phase 5 — Remove the artifact cache and retire DUFS/Pages deployment

- [x] Remove cache task commands and cache-specific orchestration from `scripts/task.ts` and `package.json`. (Done 2026-10-19: `cache:restore`/`cache:save` commands, `useCache` branches, and the `prepare-dist` restore step removed; `scripts/sync.ts` `--use-cache`/`--restore-cache-only` flags removed.)
- [x] Delete `scripts/cache.ts`, `scripts/cache/`, and cache-only tests after callers and coverage are updated. (Done 2026-10-19: 8 module files plus 7 test files deleted: `cache-*.test.ts` + `archive.test.ts`.)
- [x] Remove the S3/R2 cache dependency, cache environment variables, cache-related README instructions, and cache-only workflow settings. (Done 2026-10-19: `@bradenmacdonald/s3-lite-client` + `tar` deps removed; `S3_*` env removed from `update.yml` and `.env.example`; README had no cache references; pnpm store `cache: pnpm` kept.)
- [x] Retire DUFS and Pages deployment: remove `sync-to-dufs`, its Rclone setup and `RCLONE_CONFIG`, and the `publish-to-pages` job. (Done 2026-10-20 in `70a8e9d`: both jobs removed, `RCLONE_CONFIG` deleted from `.env.example` and GH secrets, repo grep clean. README hosting rewritten to Workers + Netlify; `x.amar.kim` DNS cut to Netlify with cert active, verified 2026-10-20: apex 200, APK 302, `index.pb` byte-identical across all three hosts. GitLab mirror kept.)
- [x] Deploy only after a successful publisher run: prepare binary-free `dist/` with a complete manifest and `_redirects`, deploy Cloudflare Workers Static Assets with Wrangler from `.github/workflows/update.yml`, and ship the same prebuilt `dist/` to Netlify with the CLI (`deploy --prod --dir dist`). (Done 2026-10-20 in `70a8e9d`/`820bfdb`/`a6c967a`/`951becd`: single gated `deploy` job, manifest fetch fail-closed, both deploys tagged `deploy <sha>`; direct main-branch production auto-deploys disabled on both hosts by disconnecting the host-side repo connections. CLI prebuilt deploy used instead of a Netlify Build Hook so both hosts serve byte-identical output.)
- [x] Remove remaining cache and binary-materialization references from active scripts, workflows, docs, and tests. (Done 2026-10-19: stale comments, generic log strings, and one test name cleaned; remaining `cache` mentions are pnpm store caching, in-memory memoization, and one historical comment.)

**Gate:** No active command or workflow restores/saves the R2 cache, syncs to DUFS, publishes the Pages branch, or uploads APK/JAR files. Workers and Netlify deploy only after release publication and serve binary-free output with redirects pointing to existing immutable assets.

### Phase 6 — Bootstrap, cut over, and verify

- [ ] Recount the pinned source inventory, then bootstrap the current APKs and available Mihon JARs from the four retained sources across at least four releases (current estimate: 3,144 binaries). Keep each release to at most 999 binaries plus its manifest; exclude Kohi-den. Switch catalog links only after all batches and URLs are verified.
- [x] Deploy the release-backed catalog and site to Cloudflare Workers Static Assets and Netlify, then verify repository index URLs, generated PB payloads, and legacy `_redirects` behavior on all hosts. (Done 2026-10-20 in run `39420320258`: apex 200, `/yuzono/anime/apk/*` 302 to immutable release URLs, `/secozzi/index.pb` 200, Yuzono `index.pb` 200 — byte-identical across `x.noz.one`, `x.ujol.dev`, and `x.amar.kim`.)
- [x] Keep previously hosted binaries during the verification window; remove them only after release links and client compatibility are confirmed. (Moot 2026-10-19: no hosted APK/JARs have shipped since Phase 3 — nothing to keep or remove. The verification-window concept still applies to link cutover.)
- [x] Add tests for artifact discovery across the four retained sources, Kohi-den exclusion, checksum comparison, immutable/idempotent release planning, manifest URL generation, unchanged-run behavior, and binary-free `dist/` output. (Done 2026-10-19 in `d231e7d`: Kohi-den exclusion was the last gap — all 7 items covered, 55 tests pass. No live-network download tests by decision.)
- [ ] Run the existing checks (`pnpm test`, `pnpm check`, `pnpm lint`, and production build) and record results in the PR.
- [ ] Update these phase checkboxes and the PR checklist as each phase is completed.

**Gate:** Exactly four sources (two Mihon, two Aniyomi) remain advertised; Kohi-den is absent and is not polled or republished. Secozzi and Yuzono Anime serve Aniyomi-compatible PB indexes with metadata intact; legacy Yuzono APK paths redirect (302) to immutable Release assets on Workers and Netlify. Website buttons use GitHub Release URLs; Mihon indexes retain upstream signing keys. Hosted output is binary-free; no release exceeds 1,000 assets; unchanged republishing is a no-op.

## Risks and decisions to resolve

- **Mihon index integrity:** The mirror may regenerate `index.pb` with Release URLs without the upstream private key, but must preserve the source store's APK `signingKey` and mirror APK bytes exactly. Mihon rejects APKs whose signatures do not match that key. Encoder implemented (`scripts/generate-index.ts` + `scripts/proto/mihon/extensionstore.proto`); hermetic decode-proof done (1439/1439 real Keiyoushi entries round-trip exact). In-app Mihon acceptance of a regenerated `index.pb` is still required before cutover.
- **Aniyomi protobuf compatibility:** Secozzi already uses the separate Aniyomi codec (`isTorrent=8`, `sources=9`, `Source.message=6`, resources APK/icon 1/2); wire-format tests pass and Animiru acceptance was confirmed by the owner. Yuzono Anime must reuse the same Aniyomi codec for its converted PB; verify its bytes against the independent schema and both app consumers before cutover.
- **Source differences:** The four retained sources differ in artifact URL shape and JAR availability. Layouts validated 2026-10-19 against pinned refs (Keiyoushi/Cursed: release-download APK+JAR URLs; Secozzi: release-download APKs, no JAR; Anime: `apk/` git-tree, no JAR); skip JARs that are not offered rather than inventing URLs. Kohi-den is retired and excluded from the publisher.
- **Secozzi index paths:** The authoritative upstream input remains `index.json` plus `release-assets.json`; the public mirror endpoint is `/secozzi/index.pb`. Keep the Aniyomi category and use Aniyomi-compatible protobuf encoding for that endpoint.
- **Publish/deploy ordering:** Only Cloudflare Workers Static Assets and Netlify remain. The release publisher runs first; `.github/workflows/update.yml` runs only after publisher success, deploys `dist` to Workers with Wrangler, and ships the same prebuilt `dist/` to Netlify with the CLI. Independent production auto-deploys on `main` stay disabled on both hosts. Site builds must use the complete release manifest before generating catalogs and `_redirects`, and must not advertise assets before GitHub has published them. DUFS and Pages-branch publishing are retired.
- **Release asset cap:** The current inventory estimate is 3,144 binaries, so the initial import cannot fit in one release; plan at least four bootstrap releases, with at most 999 binaries plus one manifest each, and recount before publishing.
- **Release history:** Historical assets remain available. Current catalog entries should point to each asset's immutable release URL, not a mutable `latest` URL.
- **Cutover safety:** Do not remove hosted APK/JAR files until the initial release and all generated URLs have been verified.
- **Schedule:** GitHub Actions checks upstreams every four hours using `0 */4 * * *` UTC.

## Follow-up — 2026-10-20 14:52:55 +0800

- Owner confirmed Secozzi's public mirror endpoint is `/secozzi/index.pb`; `/secozzi/index.json` remains the authoritative upstream input.
- Source inspection of Animiru (`0b9bb0a`) and Aniyomi (`9741444`) confirms Aniyomi wire fields: `isTorrent=8`, `sources=9`, `Source.message=6`, and resource APK/icon fields 1/2.
- Phase 4 tracks a separate Aniyomi-compatible Secozzi encoder, independent wire-format tests, and manual acceptance in Aniyomi and Animiru. The existing Mihon codec remains for Mihon repositories.

## Follow-up — 2026-10-20 15:42:08 +0800

- Organized the protobuf files under `scripts/proto/mihon/` and `scripts/proto/aniyomi/`; updated the runtime loader paths.
- Verified Phase 4 automated checks: 65 tests passed and `pnpm check` reported 0 errors, warnings, or hints.
- Manual acceptance in Aniyomi, Animiru, and Mihon remains open.

## Follow-up — legacy Yuzono Anime compatibility (2026-10-20)

- Owner confirmed Animiru loads Secozzi's `index.pb`; Yuzono Anime stays legacy-only upstream, so its mirror must serve both generations.
- Phase 4 now requires an Aniyomi-compatible Yuzono Anime PB converted from flat `index.min.json` plus a static `dist/_redirects` mapping legacy `/yuzono/anime/apk/<filename>` paths to immutable Release URLs (explicit 302), keeping hosts binary-free.
- Hosting scope narrowed to Cloudflare Workers Static Assets and Netlify sharing one `_redirects` file; DUFS and Pages-branch publishing are retired. Netlify receives the same GH-built `dist/` via CLI deploy after publisher success; Workers deploys with Wrangler from the same gated workflow.
