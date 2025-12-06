import { writable } from 'svelte/store';

export const selectedDomain = writable<string>('');
