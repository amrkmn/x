import type { AppData } from '$lib/types';

export const prerender = true;

export const load = async ({ fetch }) => {
    const response = await fetch('/data.json');
    const data = (await response.json()) as AppData;

    return { ...data };
};
