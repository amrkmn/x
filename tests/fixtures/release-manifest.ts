import { parseReleaseManifest } from '../../scripts/release-publisher/manifest';
import type { ReleaseManifest } from '../../scripts/release-publisher/types';

// Fixture-only manifest for Phase 4 development (encoder proof, URL
// rewriting, frontend cutover). Sequencing decision: with no live publisher
// run there is no real release-assets.json, so Phase 4 builds against this
// fixture mirroring the exact ReleaseManifest schema. Fixture URLs must
// never appear in deployable output — production keeps upstream URLs until
// a real manifest exists (RELEASE_MANIFEST_FILE / manifest option absent).
export const FIXTURE_RELEASE_TAG = 'abc1234-1';

export function fixtureAssetUrl(name: string): string {
    return `https://github.com/amrkmn/x/releases/download/${FIXTURE_RELEASE_TAG}/${encodeURIComponent(name)}`;
}

// One representative package per retained source key: Mihon sources carry
// apk+jar, Aniyomi sources apk-only (Secozzi/Anime ship no JARs). Returned
// through parseReleaseManifest so every consumer is guaranteed a
// schema-exact manifest.
export function fixtureManifest(): ReleaseManifest {
    return parseReleaseManifest({
        keiyoushi: {
            'eu.kanade.tachiyomi.extension.en.fixture': {
                apk: {
                    name: 'keiyoushi-fixture.apk',
                    sha256: 'a'.repeat(64),
                    version: '1.0.0',
                    versionCode: 100,
                    source: 'keiyoushi',
                    kind: 'apk',
                    url: fixtureAssetUrl('keiyoushi-fixture.apk')
                },
                jar: {
                    name: 'keiyoushi-fixture.jar',
                    sha256: 'b'.repeat(64),
                    version: '1.0.0',
                    versionCode: 100,
                    source: 'keiyoushi',
                    kind: 'jar',
                    url: fixtureAssetUrl('keiyoushi-fixture.jar')
                }
            }
        },
        'yuzono/cursed': {
            'eu.kanade.tachiyomi.extension.ja.fixture': {
                apk: {
                    name: 'yuzono-cursed-fixture.apk',
                    sha256: 'c'.repeat(64),
                    version: '2.0.0',
                    versionCode: 200,
                    source: 'yuzono/cursed',
                    kind: 'apk',
                    url: fixtureAssetUrl('yuzono-cursed-fixture.apk')
                },
                jar: {
                    name: 'yuzono-cursed-fixture.jar',
                    sha256: 'd'.repeat(64),
                    version: '2.0.0',
                    versionCode: 200,
                    source: 'yuzono/cursed',
                    kind: 'jar',
                    url: fixtureAssetUrl('yuzono-cursed-fixture.jar')
                }
            }
        },
        secozzi: {
            'eu.kanade.tachiyomi.aniyomi.extension.jellyfin.fixture': {
                apk: {
                    name: 'secozzi-fixture.apk',
                    sha256: 'e'.repeat(64),
                    version: '1.5.0',
                    source: 'secozzi',
                    kind: 'apk',
                    url: fixtureAssetUrl('secozzi-fixture.apk')
                }
            }
        },
        'yuzono/anime': {
            'eu.kanade.tachiyomi.aniyomi.extension.all.fixture': {
                apk: {
                    name: 'yuzono-anime-fixture.apk',
                    sha256: 'f'.repeat(64),
                    version: '3.0.0',
                    source: 'yuzono/anime',
                    kind: 'apk',
                    url: fixtureAssetUrl('yuzono-anime-fixture.apk')
                }
            }
        }
    });
}
