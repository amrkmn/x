import Fuse from "fuse.js";
import { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Link, useSearchParams } from "react-router";
import { ExtensionRow } from "../components/ExtensionRow";

interface Extension {
    pkg: string;
    name: string;
    version: string;
    lang: string;
    apk: string;
    nsfw: number;
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
}

const formatSourceName = (sourceName: string) => {
    return sourceName.toLowerCase().replace(/\s+/g, ".");
};

const findSourceByFormattedName = (formattedName: string, availableSources: string[]) => {
    if (formattedName === "all") return "all";
    return availableSources.find((source) => formatSourceName(source) === formattedName) ?? "all";
};

export const SearchView: FunctionComponent<SearchViewProps> = ({ data }) => {
    const [searchParams, setSearchParams] = useSearchParams();

    const [query, setQuery] = useState(searchParams.get("q") ?? "");
    const [extensions, setExtensions] = useState<Extension[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filter states - initialize from URL params
    const [selectedSource, setSelectedSource] = useState<string>(searchParams.get("source") ?? "all");
    const [selectedLanguage, setSelectedLanguage] = useState<string>(searchParams.get("lang") ?? "all");
    const [showNSFW, setShowNSFW] = useState<boolean>(searchParams.get("nsfw") !== "0");

    // Sync URL params whenever filter states change
    useEffect(() => {
        const params: Record<string, string> = {};
        if (query) params.q = query;
        if (selectedSource !== "all") params.source = formatSourceName(selectedSource);
        if (selectedLanguage !== "all") params.lang = selectedLanguage;
        if (!showNSFW) params.nsfw = "0";
        setSearchParams(params);
    }, [query, selectedSource, selectedLanguage, showNSFW]);

    useEffect(() => {
        async function fetchExtensions() {
            try {
                const promises = [];

                for (const category in data.extensions) {
                    for (const repo of data.extensions[category]) {
                        const promise = fetch(`.${repo.path}`)
                            .then((res) => res.json())
                            .then((extList: Extension[]) => {
                                const repoFolder = repo.path.substring(0, repo.path.lastIndexOf("/"));
                                return extList.map((ext) => ({
                                    ...ext,
                                    repoUrl: `.${repoFolder}`,
                                    sourceName: repo.name,
                                }));
                            })
                            .catch((err) => {
                                console.error(`Failed to load extensions from ${repo.name}`, err);
                                return [];
                            });
                        promises.push(promise);
                    }
                }

                const results = await Promise.all(promises);
                setExtensions(results.flat());
            } catch (e) {
                console.error(e);
                setError("Failed to load extension data.");
            } finally {
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

    // Get unique sources and languages for filter dropdowns
    const sources = useMemo(() => {
        const _sources = extensions.map((ext) => ext.sourceName);
        return [...new Set(["all", ...Array.from(_sources).sort()])];
    }, [extensions]);

    const languages = useMemo(() => {
        const _langs = extensions.map((ext) => ext.lang);
        return [...new Set(["all", ...Array.from(_langs).sort()])];
    }, [extensions]);

    // Sync URL source param to actual source name after extensions load
    useEffect(() => {
        const urlSource = searchParams.get("source");
        if (urlSource && extensions.length > 0) {
            const actualSource = findSourceByFormattedName(urlSource, sources);
            if (actualSource !== selectedSource) {
                setSelectedSource(actualSource);
            }
        }
    }, [extensions.length]);

    const results = useMemo(() => {
        let filtered = extensions;

        if (query) filtered = fuse.search(query).map((result) => result.item);
        if (selectedSource !== "all") filtered = filtered.filter((ext) => ext.sourceName === selectedSource);
        if (selectedLanguage !== "all") filtered = filtered.filter((ext) => ext.lang === selectedLanguage);
        if (!showNSFW) filtered = filtered.filter((ext) => ext.nsfw !== 1);

        return filtered;
    }, [query, extensions, fuse, selectedSource, selectedLanguage, showNSFW]);

    if (error) return <div style="text-align: center; margin-top: 50px; color: red;">{error}</div>;

    return (
        <div class="container">
            <div class="page-header">
                <h1>Search Extensions</h1>
                <Link to="/" class="btn btn-secondary header-btn">
                    Home
                </Link>
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
            <div class="filter-bar">
                <div class="filter-group">
                    <label for="source-filter">Source:</label>
                    <select
                        id="source-filter"
                        value={selectedSource}
                        onChange={(e) => setSelectedSource((e.target as HTMLSelectElement).value)}
                    >
                        {sources.map((source) => (
                            <option key={source} value={source}>
                                {source === "all" ? "All Sources" : source}
                            </option>
                        ))}
                    </select>
                </div>
                <div class="filter-group">
                    <label for="language-filter">Language:</label>
                    <select
                        id="language-filter"
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage((e.target as HTMLSelectElement).value)}
                    >
                        {languages.map((lang) => (
                            <option key={lang} value={lang}>
                                {lang === "all" ? "All Languages" : lang}
                            </option>
                        ))}
                    </select>
                </div>
                <div class="filter-group filter-checkbox">
                    <label>
                        <input
                            type="checkbox"
                            checked={showNSFW}
                            onChange={(e) => setShowNSFW((e.target as HTMLInputElement).checked)}
                        />
                        <span>Show NSFW</span>
                    </label>
                </div>
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
                        {results.slice(0, 50).map((ext) => (
                            <ExtensionRow
                                key={`${formatSourceName(ext.sourceName)};${ext.pkg}`}
                                extension={ext}
                                repoUrl={ext.repoUrl}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
            {results.length === 0 && !loading && <div style="text-align: center; padding: 20px;">No results found.</div>}
            {loading && <div style="text-align: center; padding: 20px;">Loading extensions...</div>}
        </div>
    );
};
