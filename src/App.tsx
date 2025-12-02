import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { HashRouter, Route, Routes } from "react-router";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { SearchView } from "./pages/SearchView";

interface ExtensionRepo {
    source: string;
    name: string;
    path: string;
    commit?: string;
}

interface AppData {
    extensions: {
        [category: string]: ExtensionRepo[];
    };
    domains: string[];
    source: string;
    commitLink: string;
    latestCommitHash: string;
}

export const App: FunctionComponent = () => {
    const [data, setData] = useState<AppData | null>(null);
    const [selectedDomain, setSelectedDomain] = useState("");

    useEffect(() => {
        fetch("./data.json")
            .then((res) => res.json())
            .then((d: AppData) => {
                setData(d);
                if (d.domains && d.domains.length > 0) {
                    setSelectedDomain(d.domains[0]);
                }
            })
            .catch((err) => console.error("Failed to load data", err));
    }, []);

    if (!data) {
        return <div style="text-align: center; margin-top: 50px;">Loading...</div>;
    }

    const { extensions, domains, source, commitLink, latestCommitHash } = data;

    return (
        <HashRouter>
            <Routes>
                <Route
                    path="/"
                    element={
                        <Home
                            extensions={extensions}
                            domains={domains}
                            selectedDomain={selectedDomain}
                            setSelectedDomain={setSelectedDomain}
                        />
                    }
                />
                <Route path="/search" element={<SearchView data={data} />} />
            </Routes>
            <Footer source={source} commitLink={commitLink} latestCommitHash={latestCommitHash} />
        </HashRouter>
    );
};
