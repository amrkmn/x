import { expect, test } from 'bun:test';
import { parseSearchIndex, parseAppData } from '../src/lib/validation';
import { parseExtensionsData } from '../scripts/validation';

test('parseAppData validates and returns typed app data', () => {
    const data = parseAppData({
        extensions: {
            mihon: [
                {
                    source: 'https://github.com/example/repo',
                    name: 'Example Repo',
                    path: '/example/index.min.json',
                    commit: 'abcdef0'
                }
            ]
        },
        domains: ['https://x.example.com'],
        source: 'https://github.com/amrkmn/x',
        commitLink: 'https://github.com/amrkmn/x/commit/abcdef0',
        latestCommitHash: 'abcdef0'
    });

    expect(data.extensions.mihon[0].name).toBe('Example Repo');
    expect(data.domains[0]).toBe('https://x.example.com');
});

test('parseSearchIndex normalizes boolean nsfw values', () => {
    const index = parseSearchIndex([
        {
            name: 'Example Extension',
            pkg: 'example.pkg',
            version: '1.0.0',
            lang: 'en',
            apk: 'example.apk',
            nsfw: true,
            repoUrl: '/example',
            sourceName: 'Example Source',
            formattedSourceName: 'example.source',
            category: 'mihon'
        }
    ]);

    expect(index[0].nsfw).toBe(1);
    expect(index[0].formattedSourceName).toBe('example.source');
});

test('parseExtensionsData rejects duplicate paths', () => {
    expect(() =>
        parseExtensionsData({
            mihon: {
                one: {
                    source: 'https://github.com/example/one',
                    name: 'One',
                    path: '/shared/index.min.json',
                    commit: 'abc'
                }
            },
            aniyomi: {
                two: {
                    source: 'https://github.com/example/two',
                    name: 'Two',
                    path: '/shared/index.min.json',
                    commit: 'def'
                }
            }
        })
    ).toThrow('Duplicate extension path: /shared/index.min.json');
});
