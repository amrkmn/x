<script lang="ts">
    import { stripBranchSuffix } from '$lib/search/utils';

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

    const repoUrl = $derived(stripBranchSuffix(repo.source));
    const isMihon = $derived(protocol === 'tachiyomi');
    let copied = $state(false);

    async function copyIndexUrl() {
        const indexUrl = `${selectedDomain}${repo.path}`;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(indexUrl);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = indexUrl;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const copiedToClipboard = document.execCommand('copy');
                textarea.remove();
                if (!copiedToClipboard) throw new Error('Copy failed');
            }

            copied = true;
            setTimeout(() => (copied = false), 1500);
        } catch {
            copied = false;
        }
    }
</script>

<div class="card">
    <div class="card-header">
        <a href={repoUrl} target="_blank" rel="noopener noreferrer" class="card-title">
            {repo.name}
        </a>
        <div class="card-meta">
            {#if repo.commit}
                Commit:{' '}
                <a
                    href={`${repoUrl}/commit/${repo.commit}`}
                    target="_blank"
                    rel="noopener noreferrer"
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
        {#if isMihon}
            <button type="button" class="btn btn-secondary" onclick={copyIndexUrl}>
                {copied ? 'Copied' : 'Copy Index URL'}
            </button>
        {:else}
            <a
                href={`${selectedDomain}${repo.path}`}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-secondary"
            >
                JSON
            </a>
        {/if}
    </div>
</div>
