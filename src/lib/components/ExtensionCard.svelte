<script lang="ts">
    interface Props {
        repo: {
            source: string;
            name: string;
            path: string;
            commit?: string;
        };
        protocol: string;
        selectedDomain: string;
    }

    let { repo, protocol, selectedDomain }: Props = $props();
</script>

<div class="card">
    <div class="card-header">
        <a href={repo.source} target="_blank" class="card-title">
            {repo.name}
        </a>
        <div class="card-meta">
            {#if repo.commit}
                Commit:{' '}
                <a
                    href={`${repo.source}/commit/${repo.commit}`}
                    target="_blank"
                    class="commit-link"
                >
                    {repo.commit.substring(0, 7)}
                </a>
            {:else}
                Commit: N/A
            {/if}
        </div>
    </div>
    <div class="card-actions">
        <a
            href={`${protocol}://add-repo?url=${selectedDomain}${repo.path}`}
            class="btn btn-primary"
        >
            Add Repo
        </a>
        <a href={`${selectedDomain}${repo.path}`} target="_blank" class="btn btn-secondary">
            JSON
        </a>
    </div>
</div>
