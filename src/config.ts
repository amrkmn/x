export const config = {
    github: {
        owner: "amrkmn",
        repo: "x",
        branch: "main",
    },
    domains: [
        "https://x.noz.one", //
        "https://x.ujol.dev",
        "https://x.ujol.workers.dev",
        "https://amrkmn.github.io/x",
    ],
    directories: {
        output: "dist",
        templates: "src/views",
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
