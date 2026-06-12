import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';

export default defineConfig({
    integrations: [svelte()],
    output: 'static',
    publicDir: 'static'
});
