import React, { useState, useEffect } from 'react';
import { notionService } from '../services/notionService';
import { NotionConfig, NotionResource } from '../types';

interface NotionConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: NotionConfig | undefined; // Existing config
    onSave: (config: NotionConfig) => void;
}

const NotionConfigModal: React.FC<NotionConfigModalProps> = ({ isOpen, onClose, config, onSave }) => {
    const [token, setToken] = useState(config?.accessToken || '');
    const [resources, setResources] = useState<NotionResource[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(config?.selectedResources?.map(r => r.id) || []));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [step, setStep] = useState<'token' | 'select'>(config?.accessToken ? 'select' : 'token');
    const [searchQuery, setSearchQuery] = useState('');

    // Hydrate initial state if config changes
    useEffect(() => {
        if (config?.accessToken) {
            setToken(config.accessToken);
            setSelectedIds(new Set(config.selectedResources.map(r => r.id)));
            setStep('select');
            fetchResources(config.accessToken);
        }
    }, [config, isOpen]);


    const fetchResources = async (accessToken: string) => {
        setLoading(true);
        setError('');
        try {
            const results = await notionService.search(accessToken, searchQuery);
            setResources(results);
            setStep('select');
        } catch (e: any) {
            setError(e.message || "Failed to connect to Notion");
            setStep('token'); // Go back on error
        } finally {
            setLoading(false);
        }
    };

    const handleConnect = () => {
        if (!token) return;
        fetchResources(token);
    };

    const toggleResource = (resource: NotionResource) => {
        const next = new Set(selectedIds);
        if (next.has(resource.id)) {
            next.delete(resource.id);
        } else {
            next.add(resource.id);
        }
        setSelectedIds(next);
    };

    const handleSave = () => {
        // Map selected IDs back to full resource objects
        const selectedResources = resources.filter(r => selectedIds.has(r.id));

        // If some selected IDs are not in current search results (e.g. from previous load), 
        // we should try to preserve them if possible, or just accept we need them in list.
        // Ideally we merge with existing config resources to keep metadata for hidden items.
        const existingMap = new Map((config?.selectedResources || []).map(r => [r.id, r]));
        const finalSelection: NotionResource[] = [];

        selectedIds.forEach(id => {
            const fromSearch = resources.find(r => r.id === id);
            const fromExisting = existingMap.get(id);
            if (fromSearch) finalSelection.push(fromSearch);
            else if (fromExisting) finalSelection.push(fromExisting as NotionResource);
        });

        onSave({
            accessToken: token,
            selectedResources: finalSelection
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
                            <i className="fas fa-book text-slate-400"></i>
                            {/* Use generic icon or Notion branding if available in FA */}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Notion Integration</h2>
                            <p className="text-xs text-slate-400">Connect pages for analysis context</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">

                    {step === 'token' && (
                        <div className="space-y-4">
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-200">
                                <p className="font-semibold mb-1"><i className="fas fa-info-circle mr-2"></i>How to connect:</p>
                                <ol className="list-decimal list-inside space-y-1 text-xs opacity-80">
                                    <li>Go to <a href="https://www.notion.so/my-integrations" target="_blank" className="underline hover:text-white">Notion My Integrations</a>.</li>
                                    <li>Create a new "Internal Integration".</li>
                                    <li>Copy the "Internal Integration Secret" (starts with `secret_`).</li>
                                    <li>Go to the specific Page(s) you want to share.</li>
                                    <li>Click "..." &gt; "Connect to" &gt; Select your new integration.</li>
                                </ol>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Integration Secret</label>
                                <input
                                    type="password"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-slate-600"
                                    placeholder="secret_..."
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                />
                            </div>
                        </div>
                    )}

                    {step === 'select' && (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
                                        placeholder="Search pages..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && fetchResources(token)}
                                    />
                                </div>
                                <button
                                    onClick={() => fetchResources(token)}
                                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm transition-colors"
                                >
                                    Refresh
                                </button>
                                <button
                                    onClick={() => setStep('token')}
                                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm transition-colors"
                                    title="Change Token"
                                >
                                    <i className="fas fa-key"></i>
                                </button>
                            </div>

                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                {loading ? (
                                    <div className="text-center py-8 text-slate-500 text-sm animate-pulse">Scanning Notion Workspace...</div>
                                ) : resources.length === 0 ? (
                                    <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-800 rounded-xl">
                                        No pages found. Make sure to "Connect" the integration to pages in Notion.
                                    </div>
                                ) : (
                                    resources.map(res => (
                                        <div
                                            key={res.id}
                                            onClick={() => toggleResource(res)}
                                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-all ${selectedIds.has(res.id) ? 'bg-blue-600/20 border-blue-500/50' : 'bg-slate-800/30 border-slate-800 hover:border-slate-600'}`}
                                        >
                                            <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${selectedIds.has(res.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-600'}`}>
                                                {selectedIds.has(res.id) && <i className="fas fa-check text-[10px] text-white"></i>}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-medium text-white truncate">{res.icon} {res.title}</h4>
                                                <p className="text-[10px] text-slate-500 truncate mt-0.5">{res.type} • ID: {res.id}</p>
                                            </div>
                                            <a href={res.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-500 hover:text-white p-2">
                                                <i className="fas fa-external-link-alt text-xs"></i>
                                            </a>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="text-right text-xs text-slate-500">
                                {selectedIds.size} {selectedIds.size === 1 ? 'resource' : 'resources'} selected
                            </div>

                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400 text-xs">
                            <i className="fas fa-exclamation-circle"></i>
                            {error}
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700 flex justify-end gap-3 bg-slate-900/50 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-400 hover:text-white text-sm font-semibold transition-colors"
                    >
                        Cancel
                    </button>

                    {step === 'token' ? (
                        <button
                            onClick={handleConnect}
                            disabled={loading || !token}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {loading ? 'Verifying...' : 'Next: Select Pages'}
                        </button>
                    ) : (
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            Save Selection
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};

export default NotionConfigModal;
