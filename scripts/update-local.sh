#!/usr/bin/env bash
# Local equivalent of the retired `pnpm run update` (full) command:
# materialize upstream changes into static/, regenerate data.json /
# indexes.json, and push the search index to Meilisearch.
# Unlike `prepare-dist`, this does not build dist/, generate _redirects,
# or fail on missing release manifests.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p /tmp/manifest
if curl -fSL -o /tmp/manifest/release-assets.json \
    "https://github.com/amrkmn/x/releases/latest/download/release-assets.json"; then
    export RELEASE_MANIFEST_FILE=/tmp/manifest/release-assets.json
else
    echo "warning: no published manifest; continuing with upstream URLs" >&2
fi

pnpm run update:static
pnpm run data:generate
pnpm run search:update
