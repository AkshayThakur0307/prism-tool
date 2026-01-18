import React, { useState, useEffect } from 'react';
import { ConfluenceConfig, ConfluencePage } from '../types';
import { confluenceService } from '../services/confluenceService';

interface ConfluenceConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: ConfluenceConfig | undefined;
    onSave: (config: ConfluenceConfig) => void;
}

export const ConfluenceConfigModal: React.FC<ConfluenceConfigModalProps> = ({ isOpen, onClose, config, onSave }) => {
    const [domain, setDomain] = useState(config?.domain || '');
    const [email, setEmail] = useState(config?.email || '');
    const [apiToken, setApiToken] = useState(config?.apiToken || '');
    const [spaceKey, setSpaceKey] = useState(config?.spaceKey || '');

    // Step 2: Resource Selection
    const [step, setStep] = useState<'credentials' | 'selection'>(config?.apiToken ? 'selection' : 'credentials');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<ConfluencePage[]>([]);
    const [selectedPages, setSelectedPages] = useState<ConfluencePage[]>(config?.selectedResources || []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [hasSearched, setHasSearched] = useState(false);

    useEffect(() => {
        if (isOpen && config?.apiToken) {
            setDomain(config.domain);
            setEmail(config.email);
            setApiToken(config.apiToken);
            setSpaceKey(config.spaceKey || '');
            setSelectedPages(config.selectedResources || []);
            setStep('selection');
        } else if (isOpen) {
            setStep('credentials');
        }
    }, [isOpen, config]);

    // Auto-fetch pages when entering selection step
    useEffect(() => {
        if (step === 'selection' && config?.apiToken && searchResults.length === 0 && !hasSearched) {
            const fetchRecent = async () => {
                setLoading(true);
                try {
                    const tempConfig: ConfluenceConfig = { domain, email, apiToken };
                    // Fetch recent pages: type=page order by lastModified desc
                    // Add space filter if provided
                    const spaceFilter = spaceKey ? ` AND space = "${spaceKey}"` : '';
                    const query = `type="page"${spaceFilter} order by lastModified desc`;

                    const results = await confluenceService.searchPages(tempConfig, query, true); // true = rawCql
                    setSearchResults(results);
                } catch (e) {
                    console.error("Auto-fetch failed", e);
                } finally {
                    setLoading(false);
                }
            };
            fetchRecent();
        }
    }, [step, config?.apiToken, domain, email, apiToken, searchResults.length, hasSearched, spaceKey]); // Added spaceKey dependency

    const handleCredentialsSubmit = () => {
        if (!domain || !email || !apiToken) {
            setError("Please fill in all required fields.");
            return;
        }
        setError('');
        setStep('selection');
    };

    const handleSearch = async () => {
        console.log("[ConfluenceModal] Search clicked. Query:", searchQuery);

        if (!searchQuery.trim()) {
            setError("Please enter a search term.");
            return;
        }

        setLoading(true);
        setError('');
        setHasSearched(false);
        try {
            // Construct config for service call
            const tempConfig: ConfluenceConfig = { domain, email, apiToken };
            console.log("[ConfluenceModal] Calling service with config:", { domain, email, hasToken: !!apiToken });

            if (!confluenceService) {
                throw new Error("Service is undefined! Check imports.");
            }

            // Simple CQL: type=page AND title ~ "query"
            // Add space filter if provided
            const spaceFilter = spaceKey ? ` AND space = "${spaceKey}"` : '';
            const query = `type="page"${spaceFilter} AND title ~ "${searchQuery}"`;

            const results = await confluenceService.searchPages(tempConfig, query);

            console.log("[ConfluenceModal] Results received:", results.length);

            setSearchResults(results);
            setHasSearched(true);
        } catch (err: any) {
            console.error("Confluence Search Error:", err);
            setError(`Failed to search: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const togglePageSelection = (page: ConfluencePage) => {
        const exists = selectedPages.find(p => p.id === page.id);
        if (exists) {
            setSelectedPages(prev => prev.filter(p => p.id !== page.id));
        } else {
            setSelectedPages(prev => [...prev, page]);
        }
    };

    const handleValuesSave = () => {
        onSave({
            domain,
            email,
            apiToken,
            spaceKey,
            selectedResources: selectedPages
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-xl w-full max-w-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-900/30 flex items-center justify-center border border-blue-500/30">
                            <i className="fab fa-confluence text-blue-400 text-xl"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Confluence Integration</h2>
                            <p className="text-xs text-slate-400">
                                {step === 'credentials' ? 'Step 1: Connection Details' : 'Step 2: Select Grounding Context'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1">
                    {step === 'credentials' ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Confluence Domain</label>
                                <input
                                    type="text"
                                    value={domain}
                                    onChange={(e) => setDomain(e.target.value)}
                                    placeholder="your-site.atlassian.net"
                                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="user@example.com"
                                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-slate-600"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">API Token</label>
                                <input
                                    type="password"
                                    value={apiToken}
                                    onChange={(e) => setApiToken(e.target.value)}
                                    placeholder="Atlassian API Token"
                                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-slate-600"
                                />
                                <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                                    <i className="fas fa-external-link-alt"></i>
                                    Get token at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" className="text-blue-400 hover:text-blue-300 underline">id.atlassian.com</a>
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Space Key (Optional)</label>
                                <input
                                    type="text"
                                    value={spaceKey}
                                    onChange={(e) => setSpaceKey(e.target.value)}
                                    placeholder="e.g. DS, ENG (Leave empty for all spaces)"
                                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-slate-600"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Search Bar */}
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                                    <input
                                        type="text"
                                        placeholder={spaceKey ? `Search in space '${spaceKey}'...` : "Search all page titles..."}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={searchQuery}
                                        onChange={(e) => {
                                            console.log("Input changed:", e.target.value);
                                            setSearchQuery(e.target.value);
                                        }}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    />
                                </div>
                                <button
                                    onClick={handleSearch}
                                    disabled={loading}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg disabled:opacity-50 transition-colors"
                                >
                                    {loading ? 'Searching...' : 'Search'}
                                </button>
                            </div>

                            {/* Results List */}
                            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                                {loading ? (
                                    <div className="text-center py-8 text-slate-500 text-sm animate-pulse">Scanning Confluence...</div>
                                ) : searchResults.length > 0 ? (
                                    searchResults.map(page => {
                                        const isSelected = selectedPages.some(p => p.id === page.id);
                                        return (
                                            <div
                                                key={page.id}
                                                onClick={() => togglePageSelection(page)}
                                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-blue-900/20 border-blue-500/50' : 'bg-slate-800/30 border-slate-800 hover:border-slate-700'}`}
                                            >
                                                <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-600'}`}>
                                                    {isSelected && <i className="fas fa-check text-[10px] text-white"></i>}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-sm font-medium text-white truncate">{page.title}</h4>
                                                    <p className="text-[10px] text-slate-500 truncate mt-0.5">Space: {page.spaceKey} • v{page.version}</p>
                                                </div>
                                                <a href={page.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-500 hover:text-white p-2">
                                                    <i className="fas fa-external-link-alt text-xs"></i>
                                                </a>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center py-8 text-slate-600 text-sm border-2 border-dashed border-slate-800/50 rounded-xl">
                                        {hasSearched ? (
                                            <span className="text-amber-500">
                                                <i className="fas fa-search-minus mr-2"></i>
                                                No pages found matching "{searchQuery}"
                                            </span>
                                        ) : (
                                            "Search for pages to add context..."
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Selected Count */}
                            <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
                                <span className="text-xs text-slate-400 font-medium">Selected Context: {selectedPages.length} pages</span>
                                <button onClick={() => setStep('credentials')} className="text-xs text-blue-400 hover:text-blue-300 underline">
                                    Edit Credentials
                                </button>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-xs">
                            <i className="fas fa-exclamation-circle"></i>
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700 bg-slate-900/50 rounded-b-xl flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm font-semibold transition-colors">
                        Cancel
                    </button>
                    {step === 'credentials' ? (
                        <button
                            onClick={handleCredentialsSubmit}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 transition-all"
                        >
                            Next: Select Pages
                        </button>
                    ) : (
                        <button
                            onClick={handleValuesSave}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 transition-all"
                        >
                            Save Configuration
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};
