import React, { useState } from 'react';

interface SessionSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    summaryMarkdown: string;
    onApplyToBacklog: () => void;
    onDiscard: () => void;
}

export const SessionSummaryModal: React.FC<SessionSummaryModalProps> = ({
    isOpen, onClose, summaryMarkdown, onApplyToBacklog, onDiscard
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="w-full max-w-3xl max-h-[80vh] bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="h-16 px-8 border-b border-slate-700/50 flex items-center justify-between bg-slate-950/50">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                            <i className="fas fa-file-signature text-indigo-400"></i>
                        </div>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">Session Synthesis</h2>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-900">
                    <div className="prose prose-invert prose-sm max-w-none">
                        {/* We render simple markdown here. For a real app, use a markdown renderer. 
                            For MVP, we trust the LLM structure or do basic replacement. */}
                        <div className="whitespace-pre-wrap font-sans text-slate-300 leading-relaxed">
                            {summaryMarkdown}
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-6 border-t border-slate-700/50 bg-slate-950/30 flex justify-end gap-3">
                    <button
                        onClick={onDiscard}
                        className="px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        Discard
                    </button>
                    <button
                        onClick={onApplyToBacklog}
                        className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-900/20 flex items-center gap-2 transition-all"
                    >
                        <i className="fas fa-check-circle"></i>
                        Apply to Backlog
                    </button>
                </div>
            </div>
        </div>
    );
};
