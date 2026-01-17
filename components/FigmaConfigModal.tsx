import React, { useState } from 'react';

interface FigmaConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (accessToken: string, fileKey: string) => void;
    initialAccessToken?: string;
    initialFileKey?: string;
}

import { figmaService } from '../services/figmaService';

const FigmaConfigModal: React.FC<FigmaConfigModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialAccessToken = '',
    initialFileKey = ''
}) => {
    const [accessToken, setAccessToken] = useState(initialAccessToken);
    const [fileKey, setFileKey] = useState(initialFileKey);
    const [error, setError] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testSuccess, setTestSuccess] = useState('');
    const [debugOutput, setDebugOutput] = useState('');

    if (!isOpen) return null;

    const testConnection = async () => {
        if (!accessToken.trim()) {
            setError('Enter a token first.');
            return;
        }
        setIsTesting(true);
        setError('');
        setTestSuccess('');
        setDebugOutput('');

        try {
            // Test against the local proxy
            const response = await fetch('/figma-api/me', {
                method: 'GET',
                headers: {
                    'X-Figma-Token': accessToken
                }
            });

            if (response.ok) {
                const data = await response.json() as any;
                setTestSuccess(`Connected as ${data.handle} (${data.email})`);
            } else {
                const txt = await response.text();
                setError(`Connection Failed: ${response.status} ${response.statusText}`);
            }
        } catch (err: any) {
            setError('Network Error. Ensure dev server proxy is running.');
        } finally {
            setIsTesting(false);
        }
    };

    const handleDebugFetch = async () => {
        if (!accessToken || !fileKey) {
            setError('Token and File Key required for file test.');
            return;
        }
        setIsTesting(true);
        setError('');
        setDebugOutput('Fetching file structure...');

        try {
            // Direct Service Call (Bypassing AI)
            const result = await figmaService.getFile({ accessToken }, fileKey);
            setDebugOutput(JSON.stringify(result, null, 2));
            setTestSuccess('File fetched successfully!');
        } catch (err: any) {
            console.error(err);
            setDebugOutput(`Error fetching file: ${err.message}`);
            setError('File Fetch Failed');
        } finally {
            setIsTesting(false);
        }
    };

    const handleSubmit = () => {
        if (!accessToken.trim()) {
            setError('Access Token is required.');
            return;
        }
        setError('');
        onConfirm(accessToken, fileKey);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className={`bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col ${debugOutput ? 'h-[600px]' : 'h-auto'}`} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <i className="fab fa-figma text-purple-500"></i>
                        Connect Figma
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <p className="text-sm text-slate-400">
                        Provide your credentials. Verification occurs locally via proxy.
                    </p>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Personal Access Token</label>
                        <input
                            type="password"
                            value={accessToken}
                            onChange={(e) => setAccessToken(e.target.value)}
                            placeholder="figd_..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500/50"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Default File Key</label>
                        <input
                            type="text"
                            value={fileKey}
                            onChange={(e) => setFileKey(e.target.value)}
                            placeholder="e.g. wOK9..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500/50"
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                        <button
                            onClick={testConnection}
                            disabled={isTesting || !accessToken}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all flex items-center gap-2"
                        >
                            <i className="fas fa-plug"></i> Test Auth
                        </button>
                        <button
                            onClick={handleDebugFetch}
                            disabled={isTesting || !accessToken || !fileKey}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all flex items-center gap-2"
                        >
                            <i className="fas fa-file-code"></i> Test File Read
                        </button>
                    </div>

                    {error && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs flex items-center gap-2">
                            <i className="fas fa-exclamation-circle"></i> {error}
                        </div>
                    )}

                    {testSuccess && !debugOutput && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs flex items-center gap-2">
                            <i className="fas fa-check-circle"></i> {testSuccess}
                        </div>
                    )}

                    {debugOutput && (
                        <div className="mt-4">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Debug Response</label>
                            <pre className="w-full h-64 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[10px] text-green-400 overflow-auto font-mono">
                                {debugOutput}
                            </pre>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-800 bg-slate-950/30 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white">Cancel</button>
                    <button onClick={handleSubmit} className="px-6 py-2 rounded-lg text-sm font-bold text-white bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-600/20">Enable Agent</button>
                </div>
            </div>
        </div>
    );
};

export default FigmaConfigModal;
