import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LocationProvider, Router } from "preact-iso";
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
        <LocationProvider>
            <Router>
                <Home 
                    path="/" 
                    extensions={extensions} 
                    domains={domains} 
                    selectedDomain={selectedDomain} 
                    setSelectedDomain={setSelectedDomain} 
                />
                <SearchView path="/search" data={data} />
            </Router>
            <Footer source={source} commitLink={commitLink} latestCommitHash={latestCommitHash} />
        </LocationProvider>
    );
};
