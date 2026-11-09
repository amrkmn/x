import { expect, test } from 'vitest';

import {
    findSourceByFormattedName,
    formatSourceName,
    parseSourceUrl,
    stripBranchSuffix
} from '../src/lib/search/utils';

test('formatSourceName converts to lowercase and replaces spaces with dots', () => {
    expect(formatSourceName('Example Source')).toBe('example.source');
    expect(formatSourceName('Multiple   Spaces')).toBe('multiple.spaces');
    expect(formatSourceName('ALREADY LOWERCASE')).toBe('already.lowercase');
    expect(formatSourceName('Mixed Case')).toBe('mixed.case');
});

test('findSourceByFormattedName returns "all" for "all"', () => {
    expect(findSourceByFormattedName('all', ['Source A', 'Source B'])).toBe('all');
});

test('findSourceByFormattedName finds matching source', () => {
    const sources = ['Example Source', 'Another Source', 'Test'];
    expect(findSourceByFormattedName('example.source', sources)).toBe('Example Source');
    expect(findSourceByFormattedName('another.source', sources)).toBe('Another Source');
});

test('findSourceByFormattedName returns "all" when no match found', () => {
    const sources = ['Example Source', 'Another Source'];
    expect(findSourceByFormattedName('non.existent', sources)).toBe('all');
});

test('parseSourceUrl parses @branch and fallback', () => {
    expect(parseSourceUrl('https://github.com/org/repo')).toEqual({
        url: 'https://github.com/org/repo'
    });
    expect(parseSourceUrl('https://github.com/org/repo@branch')).toEqual({
        url: 'https://github.com/org/repo',
        branch: 'branch'
    });
});

test('stripBranchSuffix strips @branch suffix', () => {
    expect(stripBranchSuffix('https://github.com/org/repo@branch')).toBe(
        'https://github.com/org/repo'
    );
    expect(stripBranchSuffix('https://github.com/org/repo')).toBe('https://github.com/org/repo');
});
