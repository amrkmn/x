export const config = {
    github: {
        owner: "amrkmn",
        repo: "x",
        branch: "main",
    },
    domains: [
        "https://x.noz.one", //
        "https://x.ujol.dev",
        "https://amrkmn.github.io/x",
        "https://x.ujol.workers.dev",
    ],
    directories: {
        output: "dist",
        templates: "src/templates",
        extensions: "extensions",
    },
    filesToCopy: [
        "index.json", //
        "index.min.json",
        "repo.json",
        "apk",
        "icon",
    ],
};
