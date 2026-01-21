import React from 'react';
import { ProjectMetadata } from '../types';

interface ProjectConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectMetadata: ProjectMetadata;
    onMetadataChange: (key: keyof ProjectMetadata, value: string) => void;
    canEdit: boolean;
}

export const ProjectConfigModal: React.FC<ProjectConfigModalProps> = ({
    isOpen,
    onClose,
    projectMetadata,
    onMetadataChange,
    canEdit
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 rounded-3xl border border-slate-700/50 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center shadow-inner border border-slate-700">
                            <i className="fas fa-briefcase text-slate-400 text-xl"></i>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Project Settings</p>
                            <h1 className="text-xl font-black text-white uppercase tracking-tighter">Global Context</h1>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8">

                    {/* Read Only Warning */}
                    {!canEdit && (
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700 text-slate-400 text-xs">
                            <i className="fas fa-lock text-amber-500"></i>
                            <span>You have read-only access to this project's configuration.</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Company Name</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.companyName}
                                onChange={(e) => onMetadataChange('companyName', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="e.g. Material+"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Target Vertical</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.targetVertical}
                                onChange={(e) => onMetadataChange('targetVertical', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="e.g. Fintech, Media, Sports"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Geography</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.geography}
                                onChange={(e) => onMetadataChange('geography', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="e.g. NA, EMEA, Global..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">TAM / Market Focus</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.tam}
                                onChange={(e) => onMetadataChange('tam', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="Market size or growth goal..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Revenue Model</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.revenueModel}
                                onChange={(e) => onMetadataChange('revenueModel', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="e.g. Subscription, Ad-led..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Web Presence / References</label>
                            <input
                                type="text"
                                readOnly={!canEdit}
                                value={projectMetadata.websiteUrls}
                                onChange={(e) => onMetadataChange('websiteUrls', e.target.value)}
                                className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                placeholder="URLs for business context..."
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Competitive Benchmark</label>
                        <textarea
                            rows={2}
                            readOnly={!canEdit}
                            value={projectMetadata.keyCompetitors}
                            onChange={(e) => onMetadataChange('keyCompetitors', e.target.value)}
                            className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                            placeholder="Who are we competing with?"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Core Mission</label>
                        <textarea
                            rows={3}
                            readOnly={!canEdit}
                            value={projectMetadata.missionStatement}
                            onChange={(e) => onMetadataChange('missionStatement', e.target.value)}
                            className={`w-full bg-slate-950/40 border border-slate-800 rounded-xl p-3 text-xs text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                            placeholder="Ultimate vision for this project..."
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700 bg-slate-900/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider transition-all"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
