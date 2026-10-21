import { parseReleaseManifest } from '../../scripts/releases/manifest';
import type { ReleaseManifest } from '../../scripts/releases/types';

// Fixture-only manifest. Fixture URLs must never appear in deployable output.
export const FIXTURE_RELEASE_TAG = 'abc1234-1';

export function fixtureAssetUrl(name: string): string {
    return `https://github.com/amrkmn/x/releases/download/${FIXTURE_RELEASE_TAG}/${encodeURIComponent(name)}`;
}

// One package per source key: Mihon carries apk+jar, Aniyomi apk-only.
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
