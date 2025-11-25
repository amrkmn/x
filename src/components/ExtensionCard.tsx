import { FunctionComponent } from "preact";

interface ExtensionCardProps {
    repo: {
        source: string;
        name: string;
        path: string;
        commit?: string;
    };
    protocol: string;
    selectedDomain: string;
}

export const ExtensionCard: FunctionComponent<ExtensionCardProps> = ({ repo, protocol, selectedDomain }) => {
    return (
        <div class="card">
            <div class="card-header">
                <a href={repo.source} target="_blank" class="card-title">
                    {repo.name}
                </a>
                <div class="card-meta">
                    {repo.commit ? (
                        <>
                            Commit:{" "}
                            <a href={`${repo.source}/commit/${repo.commit}`} target="_blank" class="commit-link">
                                {repo.commit.substring(0, 7)}
                            </a>
                        </>
                    ) : (
                        "Commit: N/A"
                    )}
                </div>
            </div>
            <div class="card-actions">
                <a href={`${protocol}://add-repo?url=${selectedDomain}${repo.path}`} class="btn btn-primary">
                    Add Repo
                </a>
                <a href={`${selectedDomain}${repo.path}`} target="_blank" class="btn btn-secondary">
                    JSON
                </a>
            </div>
        </div>
    );
};
