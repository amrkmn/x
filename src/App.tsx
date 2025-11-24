import { FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { MirrorSelector } from './components/MirrorSelector';
import { ExtensionCategory } from './components/ExtensionCategory';
import { Footer } from './components/Footer';
import { SearchView } from './pages/SearchView';

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
    const [selectedDomain, setSelectedDomain] = useState('');
    const [view, setView] = useState(window.location.hash === '#/search' ? 'search' : 'home');

    useEffect(() => {
        const handleHashChange = () => {
            setView(window.location.hash === '#/search' ? 'search' : 'home');
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    useEffect(() => {
        fetch('./data.json')
            .then((res) => res.json())
            .then((d: AppData) => {
                setData(d);
                if (d.domains && d.domains.length > 0) {
                    setSelectedDomain(d.domains[0]);
                }
            })
            .catch((err) => console.error('Failed to load data', err));
    }, []);

    if (!data) {
        return <div style="text-align: center; margin-top: 50px;">Loading...</div>;
    }

    const { extensions, domains, source, commitLink, latestCommitHash } = data;

    if (view === 'search') {
        return (
            <>
                <SearchView data={data} onBack={() => (window.location.hash = '/')} />
                <Footer source={source} commitLink={commitLink} latestCommitHash={latestCommitHash} />
            </>
        );
    }

    return (
        <>
            <div class="container">
                <div class="page-header">
                    <h1>Mihon & Aniyomi Extensions</h1>
                    <button onClick={() => (window.location.hash = '/search')} class="btn btn-secondary header-btn">
                        Search
                    </button>
                </div>

                <MirrorSelector domains={domains} selectedDomain={selectedDomain} onSelect={setSelectedDomain} />

                {Object.entries(extensions).map(([category, repos]) => (
                    <ExtensionCategory category={category} repos={repos} selectedDomain={selectedDomain} />
                ))}
            </div>
            <Footer source={source} commitLink={commitLink} latestCommitHash={latestCommitHash} />
        </>
    );
};
