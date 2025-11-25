import Fuse from "fuse.js";
import { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ExtensionRow } from "../components/ExtensionRow";

interface Extension {
    pkg: string;
    name: string;
    version: string;
    lang: string;
    apk: string;
    repoUrl: string;
    sourceName: string;
}

interface ExtensionRepo {
    source: string;
    name: string;
    path: string;
    commit?: string;
}

interface SearchViewProps {
    data: {
        extensions: {
            [category: string]: ExtensionRepo[];
        };
    };
    onBack: () => void;
}

export const SearchView: FunctionComponent<SearchViewProps> = ({ data, onBack }) => {
    const [query, setQuery] = useState("");
    const [extensions, setExtensions] = useState<Extension[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchExtensions() {
            try {
                const allExtensions: Extension[] = [];
                const promises: Promise<void>[] = [];

                for (const category in data.extensions) {
                    for (const repo of data.extensions[category]) {
                        const p = fetch(`.${repo.path}`)
                            .then((res) => res.json())
                            .then((extList: Extension[]) => {
                                const repoFolder = repo.path.substring(0, repo.path.lastIndexOf("/"));
                                extList.forEach((ext) => {
                                    allExtensions.push({
                                        ...ext,
                                        repoUrl: `.${repoFolder}`,
                                        sourceName: repo.name,
                                    });
                                });
                            })
                            .catch((err) => console.error(`Failed to load extensions from ${repo.name}`, err));
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
            threshold: 0.4,
        });
    }, [extensions]);

    const results = useMemo(() => {
        if (!query) return extensions;
        return fuse.search(query).map((result) => result.item);
    }, [query, extensions, fuse]);

    if (loading) return <div style="text-align: center; margin-top: 50px;">Loading extensions...</div>;
    if (error) return <div style="text-align: center; margin-top: 50px; color: red;">{error}</div>;

    return (
        <div class="container">
            <div class="page-header">
                <h1>Search Extensions</h1>
                <button onClick={onBack} class="btn btn-secondary header-btn">
                    Home
                </button>
            </div>
            <div class="search-container">
                <input
                    type="text"
                    class="search-input"
                    placeholder="Search by name or package..."
                    value={query}
                    onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
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
                        {results.slice(0, 100).map((ext) => (
                            <ExtensionRow extension={ext} repoUrl={ext.repoUrl} />
                        ))}
                    </tbody>
                </table>
            </div>
            {results.length === 0 && <div style="text-align: center; padding: 20px;">No results found.</div>}
        </div>
    );
};
