import { writable } from 'svelte/store';

const STORAGE_KEY = 'x-mirror';

function readStored(): string {
    try {
        if (typeof localStorage === 'undefined') return '';
        return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

export const selectedDomain = writable<string>(readStored());

selectedDomain.subscribe((value) => {
    try {
        if (typeof localStorage === 'undefined') return;
        if (value) localStorage.setItem(STORAGE_KEY, value);
    } catch {
        // ignore private-mode quota errors
    }
});
