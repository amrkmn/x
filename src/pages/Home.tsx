import { FunctionComponent } from "preact";
import { ExtensionCategory } from "../components/ExtensionCategory";
import { MirrorSelector } from "../components/MirrorSelector";

interface ExtensionRepo {
    source: string;
    name: string;
    path: string;
    commit?: string;
}

interface HomeProps {
    path?: string;
    extensions: {
        [category: string]: ExtensionRepo[];
    };
    domains: string[];
    selectedDomain: string;
    setSelectedDomain: (domain: string) => void;
}

export const Home: FunctionComponent<HomeProps> = ({ extensions, domains, selectedDomain, setSelectedDomain }) => {
    return (
        <div class="container">
            <div class="page-header">
                <h1>Mihon & Aniyomi Extensions</h1>
                <a href="/search" class="btn btn-secondary header-btn">
                    Search
                </a>
            </div>

            <MirrorSelector domains={domains} selectedDomain={selectedDomain} onSelect={setSelectedDomain} />

            {Object.entries(extensions).map(([category, repos]) => (
                <ExtensionCategory category={category} repos={repos} selectedDomain={selectedDomain} />
            ))}
        </div>
    );
};
