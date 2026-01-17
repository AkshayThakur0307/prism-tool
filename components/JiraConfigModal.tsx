import React, { useState } from 'react';

interface JiraConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (domain: string, email: string, apiToken: string, projectKey: string) => void;
    initialDomain?: string;
    initialEmail?: string;
    initialApiToken?: string;
    initialProjectKey?: string;
}

const JiraConfigModal: React.FC<JiraConfigModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    initialDomain = '',
    initialEmail = '',
    initialApiToken = '',
    initialProjectKey = ''
}) => {
    const [domain, setDomain] = useState(initialDomain);
    const [email, setEmail] = useState(initialEmail);
    const [apiToken, setApiToken] = useState(initialApiToken);
    const [projectKey, setProjectKey] = useState(initialProjectKey);

    const [error, setError] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testSuccess, setTestSuccess] = useState('');

    if (!isOpen) return null;

    const testConnection = async () => {
        if (!domain || !email || !apiToken) {
            setError('Domain, Email, and Token are required.');
            return;
        }
        setIsTesting(true);
        setError('');
        setTestSuccess('');

        try {
            // Encode for Basic Auth
            const authHeader = `Basic ${btoa(`${email}:${apiToken}`)}`;

            // Test "Myself" endpoint via Proxy
            const response = await fetch('/jira-api/rest/api/3/myself', {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/json',
                    'X-Jira-Domain': domain
                }
            });

            if (response.ok) {
                const data = await response.json() as any;
                setTestSuccess(`Connected as ${data.displayName} (${data.emailAddress})`);
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

    const handleSubmit = () => {
        if (!domain || !email || !apiToken || !projectKey) {
            setError('All fields are required.');
            return;
        }
        setError('');
        onConfirm(domain, email, apiToken, projectKey);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col h-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <i className="fab fa-jira text-blue-500"></i>
                        Connect Jira
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <p className="text-sm text-slate-400">
                        Provide credentials to enable the Autonomous Jira Agent.
                    </p>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Jira Domain</label>
                        <input
                            type="text"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            placeholder="your-company.atlassian.net"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                        <input
                            type="text"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@company.com"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">API Token</label>
                        <input
                            type="password"
                            value={apiToken}
                            onChange={(e) => setApiToken(e.target.value)}
                            placeholder="AT..."
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Project Key</label>
                        <input
                            type="text"
                            value={projectKey}
                            onChange={(e) => setProjectKey(e.target.value)}
                            placeholder="KAN"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                        <button
                            onClick={testConnection}
                            disabled={isTesting || !apiToken}
                            className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all flex items-center gap-2"
                        >
                            <i className="fas fa-plug"></i> Test Connection
                        </button>
                    </div>

                    {error && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs flex items-center gap-2">
                            <i className="fas fa-exclamation-circle"></i> {error}
                        </div>
                    )}

                    {testSuccess && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs flex items-center gap-2">
                            <i className="fas fa-check-circle"></i> {testSuccess}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-800 bg-slate-950/30 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white">Cancel</button>
                    <button onClick={handleSubmit} className="px-6 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/20">Enable Agent</button>
                </div>
            </div>
        </div>
    );
};

export default JiraConfigModal;
