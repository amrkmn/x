import { FunctionComponent } from "preact";
import { ExtensionCard } from "./ExtensionCard";

interface ExtensionCategoryProps {
    category: string;
    repos: Array<{
        source: string;
        name: string;
        path: string;
        commit?: string;
    }>;
    selectedDomain: string;
}

export const ExtensionCategory: FunctionComponent<ExtensionCategoryProps> = ({ category, repos, selectedDomain }) => {
    const protocol = category.toLowerCase() === "mihon" ? "tachiyomi" : "aniyomi";

    return (
        <div class={category}>
            <h2>{category.charAt(0).toUpperCase() + category.slice(1)} Extensions</h2>
            <div class="grid">
                {repos.map((repo) => (
                    <ExtensionCard repo={repo} protocol={protocol} selectedDomain={selectedDomain} />
                ))}
            </div>
        </div>
    );
};
