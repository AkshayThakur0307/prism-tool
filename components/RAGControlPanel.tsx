
import React from 'react';
import { DiscoveryStage, VectorNamespace, AppState } from '../types';

interface RAGControlPanelProps {
    currentStage: DiscoveryStage;
    enabledNamespaces: VectorNamespace[];
    onToggle: (namespace: VectorNamespace) => void;
}

const AVAILABLE_NAMESPACES: { id: VectorNamespace; label: string; icon: string; description: string }[] = [
    {
        id: 'market-intelligence',
        label: 'Market Intel',
        icon: 'fa-globe',
        description: 'Competitor reports & industry trends'
    },
    {
        id: 'corp-strategy',
        label: 'Strategy Docs',
        icon: 'fa-chess',
        description: 'OKRs, Board Decks & Mission'
    },
    {
        id: 'jira-history',
        label: 'Jira History',
        icon: 'fa-history',
        description: 'Past Epics & Stories'
    },
    {
        id: 'data-dictionary',
        label: 'Data Dict',
        icon: 'fa-database',
        description: 'Metric definitions & Schemas'
    }
];

import { useRBAC } from '../src/hooks/useRBAC';

export const RAGControlPanel: React.FC<RAGControlPanelProps> = ({ currentStage, enabledNamespaces, onToggle }) => {
    const { canUseEnterpriseRAG } = useRBAC();

    return (
        <div className="bg-slate-900/50 rounded-xl border border-slate-700/50 p-3 mb-4 relative">
            {/* RBAC Lock Overlay */}
            {!canUseEnterpriseRAG && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center text-center p-4 border border-indigo-500/20 rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center mb-2 shadow-lg border border-slate-700">
                        <i className="fas fa-lock text-amber-400 text-xs"></i>
                    </div>
                    <h4 className="text-xs font-semibold text-slate-200 mb-0.5">Enterprise Feature</h4>
                    <p className="text-[10px] text-slate-400 max-w-[180px]">
                        RAG Knowledge Base access is restricted to Pro & Admin users.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <i className="fas fa-network-wired text-indigo-400 text-xs"></i>
                </div>
                <div>
                    <h3 className="text-xs font-bold text-indigo-100 uppercase tracking-wider flex items-center gap-2">
                        Enterprise Context (RAG)
                        <div className="relative group">
                            <i className="fas fa-info-circle text-slate-500 hover:text-indigo-400 cursor-help transition-colors"></i>
                            {/* Tooltip */}
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                <p className="text-[10px] text-slate-300 leading-relaxed font-normal normal-case tracking-normal">
                                    Retrieval-Augmented Generation (RAG) injects relevant context from your company's knowledge bases. Use this to ground the AI in your company's strategy, history, and data.
                                </p>
                                {/* Arrow */}
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-900 border-r border-b border-slate-700 transform rotate-45 -mt-1"></div>
                            </div>
                        </div>
                    </h3>
                    <p className="text-[10px] text-slate-400">Select knowledge bases to ground the AI response</p>
                </div>
            </div>

            <div className={`grid grid-cols-2 gap-2 ${!canUseEnterpriseRAG ? 'opacity-20 pointer-events-none' : ''}`}>
                {AVAILABLE_NAMESPACES.map((ns) => {
                    const isActive = enabledNamespaces.includes(ns.id);
                    return (
                        <button
                            key={ns.id}
                            onClick={() => onToggle(ns.id)}
                            className={`
                group relative flex items-start gap-2 p-2 rounded-lg border text-left transition-all duration-200
                ${isActive
                                    ? 'bg-indigo-500/10 border-indigo-500/50 shadow-[0_0_10px_-3px_rgba(99,102,241,0.3)]'
                                    : 'bg-slate-800/30 border-slate-700/30 hover:bg-slate-800/50 hover:border-slate-600'}
              `}
                        >
                            <div className={`
                mt-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] transition-colors
                ${isActive ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400 group-hover:bg-slate-600'}
              `}>
                                <i className={`fas ${ns.icon}`}></i>
                            </div>
                            <div>
                                <div className={`text-[11px] font-medium leading-none mb-1 ${isActive ? 'text-indigo-200' : 'text-slate-300'}`}>
                                    {ns.label}
                                </div>
                                <div className="text-[9px] text-slate-500 leading-tight">
                                    {ns.description}
                                </div>
                            </div>

                            {/* Toggle Indicator */}
                            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${isActive ? 'bg-indigo-400 shadow-[0_0_5px_rgba(129,140,248,0.8)]' : 'bg-slate-700'}`}></div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
