import { BUILD_TARGETS } from './targets';

export const config = {
    github: {
        owner: 'amrkmn',
        repo: 'x',
        branch: 'main'
    },
    domains: [...BUILD_TARGETS.map((target) => target.siteUrl), 'https://x.ujol.workers.dev'],
    filesToCopy: [
        'index.json', //
        'index.min.json',
        'index.pb',
        'repo.json',
        'icon'
    ]
};
