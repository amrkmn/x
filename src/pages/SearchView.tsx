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
    path?: string;
    data: {
        extensions: {
            [category: string]: ExtensionRepo[];
        };
    };
}

export const SearchView: FunctionComponent<SearchViewProps> = ({ data }) => {
    const [query, setQuery] = useState("");
    const [extensions, setExtensions] = useState<Extension[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchExtensions() {
            try {
                let pendingCount = 0;

                for (const category in data.extensions) {
                    for (const repo of data.extensions[category]) {
                        pendingCount++;
                        fetch(`.${repo.path}`)
                            .then((res) => res.json())
                            .then((extList: Extension[]) => {
                                const repoFolder = repo.path.substring(0, repo.path.lastIndexOf("/"));
                                const repoExtensions = extList.map((ext) => ({
                                    ...ext,
                                    repoUrl: `.${repoFolder}`,
                                    sourceName: repo.name,
                                }));
                                setExtensions((prev) => [...prev, ...repoExtensions]);
                            })
                            .catch((err) => console.error(`Failed to load extensions from ${repo.name}`, err))
                            .finally(() => {
                                pendingCount--;
                                if (pendingCount === 0) {
                                    setLoading(false);
                                }
                            });
                    }
                }

                if (pendingCount === 0) {
                    setLoading(false);
                }
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

    if (error) return <div style="text-align: center; margin-top: 50px; color: red;">{error}</div>;

    return (
        <div class="container">
            <div class="page-header">
                <h1>Search Extensions</h1>
                <a href="/" class="btn btn-secondary header-btn">
                    Home
                </a>
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
            {results.length === 0 && !loading && <div style="text-align: center; padding: 20px;">No results found.</div>}
            {loading && <div style="text-align: center; padding: 20px;">Loading extensions...</div>}
        </div>
    );
};
