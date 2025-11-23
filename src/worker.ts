export default {
    async fetch(request: Request, env: any) {
        // Serve static assets
        return env.ASSETS.fetch(request);
    },
};
