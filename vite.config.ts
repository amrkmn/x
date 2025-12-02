import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
    plugins: [
        preact({
            reactAliasesEnabled: true,
        }),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
    publicDir: "public",
});
