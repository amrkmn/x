import { expect, test } from 'bun:test';
import { findSourceByFormattedName, formatSourceName } from '../src/lib/search/utils';

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
