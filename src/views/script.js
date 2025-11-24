import { h, render } from "preact";
import { useState, useEffect, useMemo } from "preact/hooks";
import htm from "htm";
import Fuse from "fuse.js";

const html = htm.bind(h);

function MirrorSelector({ domains, selectedDomain, onSelect }) {
    return html`
        <div class="controls">
            <label for="mirror-select">Select Mirror: </label>
            <select id="mirror-select" value=${selectedDomain} onChange=${(e) => onSelect(e.target.value)}>
                ${domains.map((domain) => {
                    try {
                        return html`<option value=${domain}>${new URL(domain).hostname}</option>`;
                    } catch (e) {
                        return html`<option value=${domain}>${domain}</option>`;
                    }
                })}
            </select>
        </div>
    `;
}

function ExtensionCard({ repo, protocol, selectedDomain }) {
    return html`
        <div class="card">
            <div class="card-header">
                <a href=${repo.source} target="_blank" class="card-title">${repo.name}</a>
                <div class="card-meta">
                    ${repo.commit
                        ? html`
                              Commit: <a href="${repo.source}/commit/${repo.commit}" target="_blank" class="commit-link">
                                  ${repo.commit.substring(0, 7)}
                              </a>
                          `
                        : "Commit: N/A"}
                </div>
            </div>
            <div class="card-actions">
                <a href="${protocol}://add-repo?url=${selectedDomain}${repo.path}" class="btn btn-primary"> Add Repo </a>
                <a href="${selectedDomain}${repo.path}" target="_blank" class="btn btn-secondary"> JSON </a>
            </div>
        </div>
    `;
}

function ExtensionCategory({ category, repos, selectedDomain }) {
    const protocol = category.toLowerCase() === "mihon" ? "tachiyomi" : "aniyomi";
    return html`
        <div class=${category}>
            <h2>${category.charAt(0).toUpperCase() + category.slice(1)} Extensions</h2>
            <div class="grid">
                ${repos.map((repo) => html`<${ExtensionCard} repo=${repo} protocol=${protocol} selectedDomain=${selectedDomain} />`)}
            </div>
        </div>
    `;
}

function ExtensionRow({ extension, repoUrl }) {
    return html`
        <tr class="extension-row">
            <td class="icon-cell">
                <img 
                    src="${repoUrl}/icon/${extension.pkg}.png" 
                    alt="${extension.name}" 
                    class="extension-icon-small" 
                    loading="lazy"
                    onError=${(e) => { e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYzNlNTAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjOGI5ZiIgZm9udC1zaXplPSIxMiI+TjwvdGV4dD48L3N2Zz4='; }}
                />
            </td>
            <td class="info-cell">
                <div class="extension-name">${extension.name}</div>
                <div class="extension-pkg">${extension.pkg}</div>
            </td>
            <td class="meta-cell">
                <span class="version">v${extension.version}</span>
                <span class="lang">${extension.lang}</span>
            </td>
            <td class="action-cell">
                <a href="${repoUrl}/apk/${extension.apk}" class="btn btn-primary btn-sm">Download</a>
            </td>
        </tr>
    `;
}

function SearchView({ data, onBack }) {
    const [query, setQuery] = useState("");
    const [extensions, setExtensions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchExtensions() {
            try {
                const allExtensions = [];
                const promises = [];

                for (const category in data.extensions) {
                    for (const repo of data.extensions[category]) {
                        const p = fetch(`.${repo.path}`)
                            .then(res => res.json())
                            .then(extList => {
                                const repoFolder = repo.path.substring(0, repo.path.lastIndexOf('/'));
                                extList.forEach(ext => {
                                    allExtensions.push({
                                        ...ext,
                                        repoUrl: `.${repoFolder}`,
                                        sourceName: repo.name
                                    });
                                });
                            })
                            .catch(err => console.error(`Failed to load extensions from ${repo.name}`, err));
                        promises.push(p);
                    }
                }

                await Promise.all(promises);
                setExtensions(allExtensions);
                setLoading(false);
            } catch (e) {
                console.error(e);
                setError("Failed to load extension data.");
                setLoading(false);
            }
        }
        fetchExtensions();
    }, [data]);

    const fuse = useMemo(() => {
        return new Fuse(extensions, {
            keys: ["name", "pkg"],
            threshold: 0.4
        });
    }, [extensions]);

    const results = useMemo(() => {
        if (!query) return extensions;
        return fuse.search(query).map(result => result.item);
    }, [query, extensions, fuse]);

    if (loading) return html`<div style="text-align: center; margin-top: 50px;">Loading extensions...</div>`;
    if (error) return html`<div style="text-align: center; margin-top: 50px; color: red;">${error}</div>`;

    return html`
        <div class="container">
            <div class="page-header">
                <h1>Search Extensions</h1>
                <button onClick=${onBack} class="btn btn-secondary header-btn">Home</button>
            </div>
            <div class="search-container">
                <input 
                    type="text" 
                    class="search-input"
                    placeholder="Search by name or package..." 
                    value=${query} 
                    onInput=${(e) => setQuery(e.target.value)}
                />
            </div>
            <div class="table-container">
                <table class="extensions-table">
                    <thead>
                        <tr>
                            <th style="width: 60px;">Icon</th>
                            <th>Name / Package</th>
                            <th>Version / Lang</th>
                            <th style="width: 100px;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.slice(0, 100).map(ext => html`<${ExtensionRow} extension=${ext} repoUrl=${ext.repoUrl} />`)}
                    </tbody>
                </table>
            </div>
            ${results.length === 0 && html`<div style="text-align: center; padding: 20px;">No results found.</div>`}
        </div>
    `;
}

function Footer({ source, commitLink, latestCommitHash }) {
    return html`
        <footer>
            Source Code: <a href=${source} target="_blank">${source}</a>
            <div>Commit: <a href=${commitLink} target="_blank">${latestCommitHash}</a></div>
        </footer>
    `;
}

function App() {
    const [data, setData] = useState(null);
    const [selectedDomain, setSelectedDomain] = useState("");
    const [view, setView] = useState("home"); // 'home' or 'search'

    useEffect(() => {
        fetch("./data.json")
            .then((res) => res.json())
            .then((d) => {
                setData(d);
                if (d.domains && d.domains.length > 0) {
                    setSelectedDomain(d.domains[0]);
                }
            })
            .catch((err) => console.error("Failed to load data", err));
    }, []);

    if (!data) {
        return html`<div style="text-align: center; margin-top: 50px;">Loading...</div>`;
    }

    const { extensions, domains, source, commitLink, latestCommitHash } = data;

    if (view === "search") {
        return html`
            <${SearchView} data=${data} onBack=${() => setView("home")} />
            <${Footer} source=${source} commitLink=${commitLink} latestCommitHash=${latestCommitHash} />
        `;
    }

    return html`
        <div class="container">
            <div class="page-header">
                <h1>Mihon & Aniyomi Extensions</h1>
                <button onClick=${() => setView("search")} class="btn btn-secondary header-btn">Search</button>
            </div>

            <${MirrorSelector} domains=${domains} selectedDomain=${selectedDomain} onSelect=${setSelectedDomain} />

            ${Object.entries(extensions).map(
                ([category, repos]) =>
                    html`<${ExtensionCategory} category=${category} repos=${repos} selectedDomain=${selectedDomain} />`
            )}
        </div>
        <${Footer} source=${source} commitLink=${commitLink} latestCommitHash=${latestCommitHash} />
    `;
}

render(html`<${App} />`, document.body);
