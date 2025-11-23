import { h, render } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

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
                              Commit:
                              <a href="${repo.source}/commit/${repo.commit}" target="_blank" class="commit-link">
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

    return html`
        <div class="container">
            <h1>Mihon & Aniyomi Extensions</h1>

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
