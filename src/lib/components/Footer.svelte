<script lang="ts">
    interface Props {
        source: string;
        commitLink: string;
        latestCommitHash: string;
    }

    let { source, commitLink, latestCommitHash }: Props = $props();
</script>

<footer>
    Source Code: <a href={source} target="_blank">{source}</a>
    <div>
        Commit: <a href={commitLink} target="_blank">{latestCommitHash}</a>
    </div>
</footer>
