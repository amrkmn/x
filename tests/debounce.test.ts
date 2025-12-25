import { expect, test } from 'bun:test';
import { debounce } from '../src/lib/search/debounce';

test('debounce delays function execution', async () => {
    const results: number[] = [];
    const debouncedFn = debounce((value: number) => results.push(value), 100);

    debouncedFn(1);
    debouncedFn(2);
    debouncedFn(3);

    expect(results.length).toBe(0);

    await Bun.sleep(150);
    expect(results.length).toBe(1);
    expect(results[0]).toBe(3);
});

test('debounce resets timer on repeated calls', async () => {
    const results: number[] = [];
    const debouncedFn = debounce((value: number) => results.push(value), 100);

    debouncedFn(1);
    await Bun.sleep(50);
    debouncedFn(2);
    await Bun.sleep(50);
    debouncedFn(3);
    await Bun.sleep(50);

    expect(results.length).toBe(0);

    await Bun.sleep(150);
    expect(results.length).toBe(1);
    expect(results[0]).toBe(3);
});

test('debounce allows multiple executions over time', async () => {
    const results: number[] = [];
    const debouncedFn = debounce((value: number) => results.push(value), 50);

    debouncedFn(1);
    await Bun.sleep(100);

    debouncedFn(2);
    await Bun.sleep(100);

    expect(results.length).toBe(2);
    expect(results).toEqual([1, 2]);
});

test('debounce passes arguments correctly', async () => {
    const results: [string, number][] = [];
    const debouncedFn = debounce((text: string, num: number) => results.push([text, num]), 50);

    debouncedFn('hello', 42);
    await Bun.sleep(100);

    expect(results.length).toBe(1);
    expect(results[0]).toEqual(['hello', 42]);
});
