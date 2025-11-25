import { FunctionComponent } from "preact";

interface FooterProps {
    source: string;
    commitLink: string;
    latestCommitHash: string;
}

export const Footer: FunctionComponent<FooterProps> = ({ source, commitLink, latestCommitHash }) => {
    return (
        <footer>
            Source Code:{" "}
            <a href={source} target="_blank">
                {source}
            </a>
            <div>
                Commit:{" "}
                <a href={commitLink} target="_blank">
                    {latestCommitHash}
                </a>
            </div>
        </footer>
    );
};
