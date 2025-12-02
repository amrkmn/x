import { FunctionComponent } from "preact";
import { Link } from "react-router-dom";
import { ExtensionCategory } from "../components/ExtensionCategory";
import { MirrorSelector } from "../components/MirrorSelector";

interface ExtensionRepo {
    source: string;
    name: string;
    path: string;
    commit?: string;
}

interface HomeProps {
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
                <Link to="/search" class="btn btn-secondary header-btn">
                    Search
                </Link>
            </div>

            <MirrorSelector domains={domains} selectedDomain={selectedDomain} onSelect={setSelectedDomain} />

            {Object.entries(extensions).map(([category, repos]) => (
                <ExtensionCategory category={category} repos={repos} selectedDomain={selectedDomain} />
            ))}
        </div>
    );
};
