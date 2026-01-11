import React, { useState } from 'react';
import { projectService } from '../services/projectService';
import { useRBAC } from '../src/hooks/useRBAC';

interface ShareProjectModalProps {
    projectId: string;
    projectName: string;
    onClose: () => void;
}

export const ShareProjectModal: React.FC<ShareProjectModalProps> = ({ projectId, projectName, onClose }) => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const { role } = useRBAC();

    const handleShare = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            if (!email) {
                throw new Error("Please enter an email address.");
            }

            const result = await projectService.shareProject(projectId, email, 'viewer');
            if (result.success) {
                setSuccess(true);
                setEmail('');
            } else {
                throw new Error(result.message || "Failed to share project.");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "An error occurred.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative">

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                    <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-wider">Share Project</h2>
                        <p className="text-[10px] text-slate-400 font-medium truncate max-w-[200px]">{projectName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                    >
                        <i className="fas fa-times text-xs"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {success ? (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center">
                            <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                <i className="fas fa-check text-emerald-400 text-lg"></i>
                            </div>
                            <h3 className="text-emerald-400 font-bold mb-1">Project Shared!</h3>
                            <p className="text-white/60 text-xs mb-4">Invitation sent successfully.</p>
                            <button
                                onClick={() => setSuccess(false)}
                                className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider underline"
                            >
                                Share with another user
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleShare} className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5" htmlFor="email">
                                    Recipient Email
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="colleague@example.com"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
                                    disabled={loading}
                                />
                                <p className="mt-2 text-[10px] text-slate-500">
                                    <i className="fas fa-info-circle mr-1"></i>
                                    Recipient will be granted <strong>Viewer</strong> access only.
                                </p>
                            </div>

                            {error && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400 text-xs">
                                    <i className="fas fa-exclamation-triangle shrink-0"></i>
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={loading || !email}
                                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            <span>Sending Invite...</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-paper-plane"></i>
                                            <span>Send Invitation</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
