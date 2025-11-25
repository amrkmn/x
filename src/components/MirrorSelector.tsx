import { FunctionComponent } from "preact";

interface MirrorSelectorProps {
    domains: string[];
    selectedDomain: string;
    onSelect: (domain: string) => void;
}

export const MirrorSelector: FunctionComponent<MirrorSelectorProps> = ({ domains, selectedDomain, onSelect }) => {
    return (
        <div class="controls">
            <label for="mirror-select">Select Mirror: </label>
            <select id="mirror-select" value={selectedDomain} onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}>
                {domains.map((domain) => {
                    try {
                        return <option value={domain}>{new URL(domain).hostname}</option>;
                    } catch (e) {
                        return <option value={domain}>{domain}</option>;
                    }
                })}
            </select>
        </div>
    );
};
