import React, { useState, useEffect } from 'react';
import { detectGeography, getRegionFlag, getConfidenceColor, GeographyDetection, Region, RegulatoryBody } from '../../services/shadowCompetitor/geographyDetector';
import { shadowCompetitorOrchestrator, CompetitorInput, AnalysisResult } from '../../services/shadowCompetitor/orchestrator';
import { exportToCSV, exportToJSON, exportToPDF } from '../../services/shadowCompetitor/exportService';
import { projectService } from '../../services/projectService';
import MarkdownRenderer from '../MarkdownRenderer';
import ConfirmationModal from '../common/ConfirmationModal';

type ModalStep = 'input' | 'processing' | 'results';
type ResultTab = 'dna' | 'wargaming' | 'comparison' | 'moat' | 'citations' | 'recommendations';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    marketResearchInput: string;
    projectId?: string | null;
}

export const ShadowCompetitorModal: React.FC<Props> = ({ isOpen, onClose, marketResearchInput, projectId }) => {
    const [step, setStep] = useState<ModalStep>('input');
    const [competitors, setCompetitors] = useState<Array<{ name: string; geography: GeographyDetection }>>([]);
    const [currentInput, setCurrentInput] = useState('');
    const [userContext, setUserContext] = useState('');
    const [history, setHistory] = useState<any[]>([]);
    const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isAbortModalOpen, setIsAbortModalOpen] = useState(false);
    const [itemIdToDelete, setItemIdToDelete] = useState<string | null>(null);
    const [isAborting, setIsAborting] = useState(false);
    const [activeSidebarTab, setActiveSidebarTab] = useState<'history' | 'guide'>('history');
    const [hoveredPhase, setHoveredPhase] = useState<number | null>(null);

    // Processing state
    const [currentPhase, setCurrentPhase] = useState(1);
    const [currentCompetitor, setCurrentCompetitor] = useState('');
    const [statusText, setStatusText] = useState('');
    const [progress, setProgress] = useState(0);

    // Results state
    const [results, setResults] = useState<AnalysisResult | null>(null);
    const [activeTab, setActiveTab] = useState<ResultTab>('dna');

    // History Load Confirmation State
    const [pendingLoadAnalysis, setPendingLoadAnalysis] = useState<any>(null);

    useEffect(() => {
        if (isOpen && projectId && step === 'input') {
            projectService.getShadowAnalysisHistory(projectId).then(setHistory).catch(console.error);
        }
    }, [isOpen, projectId, step]);

    const checkLoadAnalysis = (item: any) => {
        setPendingLoadAnalysis(item);
    };

    const confirmLoadAnalysis = () => {
        if (pendingLoadAnalysis) {
            if (pendingLoadAnalysis.savedInputs && pendingLoadAnalysis.savedInputs.length > 0) {
                setCompetitors(pendingLoadAnalysis.savedInputs);
            } else if (pendingLoadAnalysis.competitors) {
                setCompetitors(pendingLoadAnalysis.competitors.map((c: string) => ({
                    name: c,
                    geography: { region: 'US', regulatoryBody: 'SEC', confidence: 'High', confidenceScore: 100, signals: [] }
                })));
            }

            if (pendingLoadAnalysis.userContext) {
                setUserContext(pendingLoadAnalysis.userContext);
            }

            if (pendingLoadAnalysis.status === 'aborted' || !pendingLoadAnalysis.result) {
                setStep('input');
            } else {
                setResults(pendingLoadAnalysis.result);
                setStep('results');
            }
            setPendingLoadAnalysis(null);
        }
    };

    const handleDeleteSingle = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setItemIdToDelete(id);
        setIsDeleteModalOpen(true);
    };

    const handleBulkDelete = () => {
        if (!selectedHistoryIds.length || !projectId) return;
        setItemIdToDelete(null);
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!projectId) return;
        if (itemIdToDelete) {
            await projectService.deleteShadowAnalysis(projectId, itemIdToDelete);
            setHistory(prev => prev.filter(h => h.id !== itemIdToDelete));
            setSelectedHistoryIds(prev => prev.filter(id => id !== itemIdToDelete));
            if (history.length === 1 && history[0].id === itemIdToDelete) {
                setCompetitors([]);
                setResults(null);
                setUserContext('');
                setProgress(0);
                setStep('input');
            }
        } else {
            await projectService.deleteShadowAnalyses(projectId, selectedHistoryIds);
            setHistory(prev => prev.filter(h => !selectedHistoryIds.includes(h.id)));
            if (history.length === selectedHistoryIds.length) {
                setCompetitors([]);
                setResults(null);
                setUserContext('');
                setProgress(0);
                setStep('input');
            }
            setSelectedHistoryIds([]);
        }
        setIsDeleteModalOpen(false);
        setItemIdToDelete(null);
    };

    const toggleSelection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedHistoryIds(prev =>
            prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = () => {
        if (selectedHistoryIds.length === history.length) {
            setSelectedHistoryIds([]);
        } else {
            setSelectedHistoryIds(history.map(h => h.id));
        }
    };

    const handleAddCompetitor = () => {
        if (currentInput.trim() && competitors.length < 5) {
            const geography = detectGeography(currentInput.trim());
            setCompetitors([...competitors, { name: currentInput.trim(), geography }]);
            setCurrentInput('');
        }
    };

    const handleRemoveCompetitor = (index: number) => {
        setCompetitors(competitors.filter((_, i) => i !== index));
    };

    const handleGeographyOverride = (index: number, region: Region, body: RegulatoryBody) => {
        const updated = [...competitors];
        updated[index].geography = {
            ...updated[index].geography,
            region,
            regulatoryBody: body,
            confidence: 'High',
            confidenceScore: 100
        };
        setCompetitors(updated);
    };

    const handleStartAnalysis = async () => {
        setStep('processing');
        const competitorInputs: CompetitorInput[] = competitors.map(c => ({
            name: c.name,
            region: c.geography.region,
            regulatoryBody: c.geography.regulatoryBody
        }));

        try {
            const result = await shadowCompetitorOrchestrator.runFullAnalysis(
                competitorInputs,
                userContext.trim() || marketResearchInput,
                (phase, competitor, status, prog) => {
                    setCurrentPhase(phase);
                    setCurrentCompetitor(competitor);
                    setStatusText(status);
                    setProgress(prog);
                }
            );

            setResults(result);
            setActiveTab('dna');
            setStep('results');

            if (projectId && !isAborting) {
                projectService.saveShadowAnalysis(
                    projectId,
                    result,
                    competitors.map(c => c.name),
                    'completed',
                    userContext,
                    competitors
                ).then(() => projectService.getShadowAnalysisHistory(projectId).then(setHistory))
                    .catch(e => console.error("Failed to auto-save:", e));
            }
        } catch (error: any) {
            if (error.message === 'Aborted by user' || isAborting) {
                console.log('Analysis background process terminated.');
            } else {
                console.error('Analysis failed:', error);
                alert('Analysis failed. Please try again.');
                setStep('input');
            }
        } finally {
            setIsAborting(false);
        }
    };

    const handleAbortClick = () => {
        setIsAbortModalOpen(true);
    };

    const confirmAbort = async () => {
        setIsAbortModalOpen(false);
        setIsAborting(true);
        shadowCompetitorOrchestrator.abort();
        if (projectId) {
            await projectService.saveShadowAnalysis(
                projectId,
                null,
                competitors.map(c => c.name),
                'aborted',
                userContext,
                competitors
            );
            projectService.getShadowAnalysisHistory(projectId).then(setHistory);
        }
        setStep('input');
    };

    if (!isOpen) return null;

    const regulatoryBodies = [...new Set(competitors.map(c => c.geography.regulatoryBody))].join(', ');

    return (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="relative w-full max-w-6xl h-[90vh] bg-slate-900 rounded-3xl border border-slate-700/50 shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-inner">
                            <i className="fas fa-microchip text-indigo-400 text-lg"></i>
                        </div>
                        <div>
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Competitive Intel</p>
                            <h1 className="text-xl font-black text-white uppercase tracking-tighter">Shadow Competitor <span className="text-indigo-500">Pro</span></h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {step === 'processing' && (
                            <div className="flex items-center gap-6 pr-4 border-r border-slate-800">
                                <div className="flex flex-col items-end">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current Progress</div>
                                    <div className="text-lg font-mono font-bold text-blue-400">{Math.round(progress)}%</div>
                                </div>
                                <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(37,99,235,0.4)]"
                                        style={{ width: `${progress}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all border border-slate-700/50 shadow-lg group"
                            title="Close Modal"
                        >
                            <i className="fas fa-times text-sm group-hover:rotate-90 transition-transform duration-300"></i>
                        </button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Left Sidebar: Control Center */}
                    <div className="w-1/4 border-r border-slate-700/50 flex flex-col overflow-hidden bg-slate-900/30 p-6">
                        <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg mb-6 border border-slate-800">
                            <button
                                onClick={() => setActiveSidebarTab('history')}
                                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeSidebarTab === 'history' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
                            >
                                <i className="fas fa-history"></i> History
                            </button>
                            <button
                                onClick={() => setActiveSidebarTab('guide')}
                                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeSidebarTab === 'guide' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-400'}`}
                            >
                                <i className="fas fa-info-circle"></i> Guide
                            </button>
                        </div>

                        {activeSidebarTab === 'history' ? (
                            <div className="flex flex-col flex-1 overflow-hidden">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                    <div className="w-1 h-3 bg-indigo-500/50 rounded-full"></div> Analysis History
                                </h3>

                                {history.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/50">
                                        <i className="fas fa-ghost text-slate-600 mb-2"></i>
                                        <p className="text-[10px] text-slate-500 leading-tight">No previous<br />simulations found</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col flex-1 overflow-hidden">
                                        <div className="flex items-center justify-between mb-3 px-1">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={history.length > 0 && selectedHistoryIds.length === history.length}
                                                    onChange={toggleSelectAll}
                                                    className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-offset-slate-900"
                                                />
                                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Select All</span>
                                            </div>
                                            {selectedHistoryIds.length > 0 && (
                                                <button
                                                    onClick={handleBulkDelete}
                                                    className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase tracking-wider transition-colors"
                                                >
                                                    Delete ({selectedHistoryIds.length})
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
                                            {history.map((item) => (
                                                <div
                                                    key={item.id}
                                                    onClick={() => checkLoadAnalysis(item)}
                                                    className="group p-3 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/80 hover:border-slate-600 transition-all cursor-pointer flex items-center justify-between"
                                                >
                                                    <div className="flex items-center gap-3 overflow-hidden">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedHistoryIds.includes(item.id)}
                                                            onClick={(e) => toggleSelection(item.id, e)}
                                                            onChange={() => { }}
                                                            className="rounded border-slate-700 bg-slate-900/50 text-blue-500 focus:ring-offset-slate-900 shrink-0"
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-xs font-bold text-white truncate">
                                                                    {item.competitors.length > 1 ? `${item.competitors.length} Competitors` : item.competitors[0]}
                                                                </span>
                                                                {item.status === 'aborted' ? (
                                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border-red-500/20 font-bold uppercase">
                                                                        Aborted
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400 font-bold uppercase">
                                                                        {new Date(item.timestamp).toLocaleDateString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-[9px] text-slate-500 font-medium truncate uppercase tracking-tight">
                                                                {item.competitors.join(' + ')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleDeleteSingle(item.id, e)}
                                                        className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                                                    >
                                                        <i className="fas fa-trash-alt text-[10px]"></i>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col flex-1 overflow-hidden">
                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                    <div className="w-1 h-3 bg-indigo-500/50 rounded-full"></div> Blueprint
                                </h3>
                                <div className="space-y-2">
                                    {[
                                        { icon: 'fa-fingerprint', title: 'DNA' },
                                        { icon: 'fa-chess-knight', title: 'War-Gaming' },
                                        { icon: 'fa-balance-scale', title: 'Benchmarking' },
                                        { icon: 'fa-shield-halved', title: 'Moat' },
                                        { icon: 'fa-bolt-lightning', title: 'Actions' }
                                    ].map((phase, i) => (
                                        <div
                                            key={i}
                                            className={`flex items-center gap-2 p-2 rounded-lg border transition-all duration-300 ${hoveredPhase === i
                                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                                                : 'border-slate-800 bg-slate-900/40 opacity-60 text-slate-500'}`}
                                        >
                                            <i className={`fas ${phase.icon} text-[10px] w-4 text-center ${hoveredPhase === i ? 'text-indigo-400' : 'text-slate-500'}`}></i>
                                            <span className="text-[9px] font-bold uppercase tracking-widest">{phase.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Panel: Conditional Content */}
                    <div className="w-3/4 flex flex-col overflow-hidden bg-slate-900/50 backdrop-blur-xl border-l border-slate-700/50">
                        {activeSidebarTab === 'guide' ? (
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-inner">
                                        <i className="fas fa-book-open text-indigo-400 text-xl"></i>
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-black text-white uppercase tracking-wider">Module Intelligence Guide</h2>
                                        <p className="text-xs text-slate-500 font-medium">Understanding the 5-phase strategic simulation engine</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 auto-rows-fr">
                                    {[
                                        {
                                            icon: 'fa-fingerprint', color: 'text-indigo-400', bg: 'bg-indigo-400/5', border: 'border-indigo-400/10',
                                            title: 'Phase 1: DNA Extraction',
                                            desc: 'AI synthesizes public 10-K filings, quarterly reports, and recent press releases to model the competitor\'s "Financial Personality".',
                                            bullets: ['Capital reserves & Burn rate', 'R&D investment intensity', 'Stated strategic priorities']
                                        },
                                        {
                                            icon: 'fa-chess-knight', color: 'text-amber-400', bg: 'bg-amber-400/5', border: 'border-amber-400/10',
                                            title: 'Phase 2: Tactical War-Gaming',
                                            desc: 'Simulates the board-room response to your roadmap items. We predict exactly how they will attempt to undercut or neutralize your feature launch.',
                                            bullets: ['Predictive counter-moves', 'Feature vulnerability check', 'Impact on local geographies']
                                        },
                                        {
                                            icon: 'fa-balance-scale', color: 'text-emerald-400', bg: 'bg-emerald-400/5', border: 'border-emerald-400/10',
                                            title: 'Phase 3: Strategic Benchmarking',
                                            desc: 'A head-to-head performance scoring of your project vs. the competitor across 12 unique strategic pillars.',
                                            bullets: ['Financial Flexibility score', 'R&D Velocity comparison', 'Execution Risk mapping']
                                        },
                                        {
                                            icon: 'fa-shield-halved', color: 'text-blue-400', bg: 'bg-blue-400/5', border: 'border-blue-400/10',
                                            title: 'Phase 4: Moat Validation',
                                            desc: 'Identifies true defensive edges (Green Flags) vs. superficial features that are likely to be instant-copied (Red Flags).',
                                            bullets: ['Proprietary moat detection', 'Copy-cat risk assessment', 'Structural defensibility']
                                        },
                                        {
                                            icon: 'fa-bolt-lightning', color: 'text-yellow-400', bg: 'bg-yellow-400/5', border: 'border-yellow-400/10',
                                            title: 'Phase 5: Actionable Recommendations',
                                            desc: 'The module concludes with 3-5 high-fidelity strategic pivots designed to exploit competitor weaknesses found in the simulation.',
                                            bullets: ['Strategic move suggestions', 'Risk mitigation steps', 'Priority focus areas']
                                        }
                                    ].map((phase, idx) => (
                                        <div
                                            key={idx}
                                            onMouseEnter={() => setHoveredPhase(idx)}
                                            onMouseLeave={() => setHoveredPhase(null)}
                                            className={`p-5 rounded-2xl border ${phase.border} ${phase.bg} hover:border-slate-600 transition-all duration-300 flex flex-col group cursor-default shadow-sm hover:shadow-lg`}
                                        >
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className={`w-8 h-8 rounded-lg ${phase.bg} flex items-center justify-center border ${phase.border} group-hover:scale-110 transition-transform`}>
                                                    <i className={`fas ${phase.icon} ${phase.color} text-sm`}></i>
                                                </div>
                                                <h3 className="font-bold text-white text-xs uppercase tracking-wider">{phase.title}</h3>
                                            </div>
                                            <p className="text-[11px] text-slate-400 leading-relaxed mb-4 flex-1">{phase.desc}</p>
                                            <ul className="space-y-1.5 mt-auto border-t border-slate-700/30 pt-4">
                                                {phase.bullets.map((b, i) => (
                                                    <li key={i} className="flex items-center gap-2 text-[10px] text-slate-500 font-medium group-hover:text-slate-300 transition-colors">
                                                        <div className={`w-1 h-1 rounded-full ${phase.color} opacity-40`}></div>
                                                        {b}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                    <div className="p-5 rounded-2xl border border-slate-700/50 bg-slate-800/20 flex flex-col justify-center items-center text-center">
                                        <i className="fas fa-info-circle text-slate-500 text-2xl mb-3"></i>
                                        <h3 className="font-bold text-white text-xs uppercase tracking-wider mb-2">Expert Tip</h3>
                                        <p className="text-[11px] text-slate-400 leading-relaxed">The quality of the "Strategic Context" determines the depth of the War-Gaming. Be specific about technical advantages.</p>
                                    </div>
                                </div>
                                <div className="mt-8 p-6 bg-gradient-to-br from-indigo-500/10 to-blue-500/10 rounded-2xl border border-indigo-500/20 flex items-center justify-between shadow-xl">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                                            <i className="fas fa-rocket text-white"></i>
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-sm">Ready to simulate?</h3>
                                            <p className="text-indigo-300/60 text-xs">Begin your analysis with a custom competitor set</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setActiveSidebarTab('history')}
                                        className="px-6 py-2.5 bg-white text-indigo-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-lg hover:scale-105 active:scale-95"
                                    >
                                        Start New Analysis
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col overflow-hidden p-6 relative">
                                {step === 'input' && (
                                    <div className="flex-1 overflow-y-auto custom-scrollbar px-3 space-y-4">
                                        {/* Info Banner */}
                                        <div className="p-3 bg-blue-900/10 border border-blue-500/20 rounded-lg">
                                            <div className="flex items-start gap-2">
                                                <i className="fas fa-lightbulb text-blue-400 text-sm mt-0.5"></i>
                                                <div className="flex-1">
                                                    <p className="text-xs text-slate-300 leading-relaxed">
                                                        Use complete legal entity names (e.g., <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">Salesforce Inc.</span>) for accurate classification.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Input Section */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                                Competitor Companies
                                            </label>
                                            <div className="flex gap-3 p-1 -m-1">
                                                <input
                                                    type="text"
                                                    value={currentInput}
                                                    onChange={(e) => setCurrentInput(e.target.value)}
                                                    onKeyPress={(e) => e.key === 'Enter' && handleAddCompetitor()}
                                                    placeholder="e.g., Salesforce Inc., Infosys Limited..."
                                                    className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none text-xs"
                                                    disabled={competitors.length >= 5}
                                                />
                                                <button
                                                    onClick={handleAddCompetitor}
                                                    disabled={!currentInput.trim() || competitors.length >= 5}
                                                    className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors"
                                                >
                                                    <i className="fas fa-plus mr-1 text-xs"></i>
                                                    Add
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-slate-500 mt-2">
                                                <i className="fas fa-globe-americas mr-1 text-blue-400"></i>
                                                Geography auto-detected • 3-5 companies recommended
                                            </p>
                                        </div>

                                        {/* Strategic Context Input */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                                Strategic Context (Optional)
                                            </label>
                                            <div className="relative p-1 -m-1">
                                                <textarea
                                                    value={userContext}
                                                    onChange={(e) => setUserContext(e.target.value)}
                                                    placeholder="Describe your roadmap, vision, or specific feature you want to test against..."
                                                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none text-xs min-h-[80px] resize-none"
                                                />
                                                <div className="absolute bottom-2 right-2 text-[10px] text-slate-600">
                                                    {userContext ? 'Overrides default context' : 'Default: Market Research Input'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Competitor List */}
                                        {competitors.length > 0 && (
                                            <div>
                                                <div className="flex items-center justify-between mb-3">
                                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                        {competitors.length} {competitors.length === 1 ? 'Company' : 'Companies'}
                                                    </label>
                                                </div>
                                                <div className="space-y-2">
                                                    {competitors.map((comp, idx) => {
                                                        const colors = getConfidenceColor(comp.geography.confidence);
                                                        return (
                                                            <div key={idx} className="p-3 bg-slate-800/30 border border-slate-700 rounded-lg hover:border-slate-600 transition-all">
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2 mb-2">
                                                                            <span className="font-medium text-white text-sm truncate">{comp.name}</span>
                                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${colors.bg} ${colors.text} border ${colors.border} shrink-0`}>
                                                                                {comp.geography.confidenceScore}%
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 text-xs">
                                                                            <span className="text-lg">{getRegionFlag(comp.geography.region)}</span>
                                                                            <span className="text-slate-400">
                                                                                {comp.geography.region} • {comp.geography.regulatoryBody}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <select
                                                                            value={`${comp.geography.region}|${comp.geography.regulatoryBody}`}
                                                                            onChange={(e) => {
                                                                                const [region, body] = e.target.value.split('|');
                                                                                handleGeographyOverride(idx, region as Region, body as RegulatoryBody);
                                                                            }}
                                                                            className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white outline-none"
                                                                        >
                                                                            <option value="US|SEC">🇺🇸 US</option>
                                                                            <option value="India|SEBI">🇮🇳 India</option>
                                                                            <option value="UK|FCA">🇬🇧 UK</option>
                                                                            <option value="EU|ESMA">🇪🇺 EU</option>
                                                                            <option value="China|CSRC">🇨🇳 China</option>
                                                                            <option value="Japan|FSA">🇯🇵 Japan</option>
                                                                        </select>
                                                                        <button
                                                                            onClick={() => handleRemoveCompetitor(idx)}
                                                                            className="w-7 h-7 rounded-lg bg-red-600/10 hover:bg-red-600/20 flex items-center justify-center transition-all"
                                                                        >
                                                                            <i className="fas fa-trash text-xs text-red-400"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {step === 'processing' && (
                                    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-900/40 rounded-2xl border border-slate-800/50 shadow-2xl">
                                        <div className="mb-8 flex flex-col items-center">
                                            <div className="w-24 h-24 rounded-full border-4 border-blue-500/10 border-t-blue-500 animate-spin mb-6"></div>
                                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] animate-pulse">
                                                Simulating Phase {currentPhase}
                                            </div>
                                        </div>

                                        <div className="w-full max-w-sm space-y-6">
                                            <div className="text-center">
                                                <div className="text-sm font-bold text-white mb-1 uppercase tracking-wider">{statusText}</div>
                                                <div className="text-[10px] text-blue-400/80 font-bold uppercase tracking-widest">Target: {currentCompetitor}</div>
                                            </div>

                                            <div className="space-y-3">
                                                {[1, 2, 3, 4, 5].map((p) => (
                                                    <div key={p} className="flex items-center gap-3">
                                                        <div className={`w-2 h-2 rounded-full transition-all duration-500 ${currentPhase > p ? 'bg-green-500' : currentPhase === p ? 'bg-blue-500 animate-ping' : 'bg-slate-800'}`}></div>
                                                        <div className={`text-[10px] font-bold uppercase tracking-wider ${currentPhase >= p ? 'text-slate-200' : 'text-slate-600'}`}>
                                                            Phase {p}: {[
                                                                'DNA & Financial Extraction (Filings/News)',
                                                                'War-Gaming & Market Response',
                                                                'Head-to-Head Benchmarking',
                                                                'Moat & Technical Validation',
                                                                'Actionable Strategic Recs'
                                                            ][p - 1]}
                                                        </div>
                                                        {currentPhase > p && <i className="fas fa-check text-[10px] text-green-500 ml-auto"></i>}
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="pt-4 text-center">
                                                <button
                                                    onClick={handleAbortClick}
                                                    className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 mx-auto border border-red-500/30 hover:border-red-500/50 transition-all shadow-lg"
                                                >
                                                    <i className="fas fa-stop-circle text-red-500"></i>
                                                    Abort Analysis
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {step === 'results' && results && (
                                    <div className="flex-1 flex flex-col overflow-hidden space-y-4">
                                        {/* Success Banner */}
                                        <div className="p-4 bg-slate-800/20 border border-slate-700 rounded-lg shrink-0">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20 shadow-sm">
                                                        <i className="fas fa-check text-green-400 text-xs"></i>
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-green-400 text-[10px] uppercase tracking-wider">Analysis Complete</div>
                                                        <div className="text-[11px] text-slate-400 mt-0.5 font-medium">
                                                            {competitors.length} {competitors.length === 1 ? 'competitor' : 'competitors'} analyzed successfully
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button onClick={exportToPDF} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors">
                                                        <i className="fas fa-file-pdf text-red-400"></i> PDF
                                                    </button>
                                                    <button onClick={() => exportToCSV(results.dna, results.warGaming, results.comparisons)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors">
                                                        <i className="fas fa-file-csv text-green-400"></i> CSV
                                                    </button>
                                                    <button onClick={() => exportToJSON(results)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors">
                                                        <i className="fas fa-code text-purple-400"></i> JSON
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tabs */}
                                        <div className="flex items-center gap-1 border-b border-slate-700 -mx-4 px-4 shrink-0">
                                            {[
                                                { id: 'dna' as ResultTab, label: 'Overview', icon: 'fa-chart-line' },
                                                { id: 'wargaming' as ResultTab, label: 'Timeline', icon: 'fa-calendar-alt' },
                                                { id: 'comparison' as ResultTab, label: 'Benchmark', icon: 'fa-balance-scale' },
                                                { id: 'moat' as ResultTab, label: 'Validation', icon: 'fa-shield-alt' },
                                                { id: 'citations' as ResultTab, label: 'Sources', icon: 'fa-link' },
                                                { id: 'recommendations' as ResultTab, label: 'Recs', icon: 'fa-lightbulb' }
                                            ].map(tab => (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => setActiveTab(tab.id)}
                                                    className={`px-4 py-2.5 text-xs font-semibold transition-all ${activeTab === tab.id ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-900/10' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/30'}`}
                                                >
                                                    <i className={`fas ${tab.icon} mr-1.5 text-[10px]`}></i>
                                                    {tab.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Tab Content */}
                                        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 mt-4 p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                            {activeTab === 'dna' && (
                                                <div className="space-y-4">
                                                    {results.dna.map((d, idx) => (
                                                        <div key={idx} className="p-4 bg-slate-800/20 rounded-lg border border-slate-700 shadow-sm">
                                                            <div className="flex justify-between items-start mb-4">
                                                                <div>
                                                                    <h4 className="text-sm font-bold text-white uppercase tracking-wide">{d.name}</h4>
                                                                    <div className="flex items-center gap-2 mt-0.5">
                                                                        <span className="text-[10px] text-slate-400 font-medium tracking-wide">COMPETITOR PROFILE</span>
                                                                        {d.confidence && (
                                                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${d.confidence.level === 'High' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : d.confidence.level === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
                                                                                {d.confidence.level} Confidence
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${(d.riskAppetite?.toString().toLowerCase().includes('high')) ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                                                                    {d.riskAppetite?.toString().split(/[-–:]/)[0].substring(0, 10) || 'Medium'} Risk
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Financial Power</div>
                                                                    <div className="space-y-1.5">
                                                                        <div className="flex justify-between items-center text-xs">
                                                                            <span className="text-slate-400">Cash Reserves</span>
                                                                            <span className="text-white font-mono font-medium">{d.financialFlexibility?.cashOnHand || 'Unknown'}</span>
                                                                        </div>
                                                                        <div className="flex justify-between items-center text-xs">
                                                                            <span className="text-slate-400">R&D Spend</span>
                                                                            <span className="text-white font-mono font-medium">{d.financialFlexibility?.rdSpend || 'Unknown'}</span>
                                                                        </div>
                                                                        <div className="mt-1 pt-1 border-t border-slate-800 text-[10px] text-blue-400 font-bold text-right">
                                                                            {d.financialFlexibility?.classification || 'Unknown'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Technical Moats</div>
                                                                    <ul className="space-y-1.5">
                                                                        {d.technicalMoats?.length ? d.technicalMoats.map((moat, i) => (
                                                                            <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                                                                                <i className="fas fa-shield-alt text-[10px] text-blue-500 mt-0.5 shrink-0"></i>
                                                                                <span>{typeof moat === 'string' ? moat : (moat as any).Moat || 'Moat'}</span>
                                                                            </li>
                                                                        )) : <li className="text-xs text-slate-500 italic">None identified</li>}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {activeTab === 'wargaming' && (
                                                <div className="space-y-4">
                                                    {results.warGaming.map((game, idx) => (
                                                        <div key={idx} className="p-4 bg-slate-800/20 rounded-lg border border-slate-700 shadow-sm">
                                                            <div className="flex justify-between items-start mb-4">
                                                                <h4 className="text-sm font-bold text-white uppercase tracking-wide">{game.competitor}</h4>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${game.probability === 'High' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                                                                    {game.probability} Probability
                                                                </span>
                                                            </div>
                                                            <div className="bg-slate-900/30 p-3 rounded border border-slate-700/30 mb-4 space-y-3">
                                                                <div>
                                                                    <div className="text-[10px] uppercase tracking-wider text-green-500/80 font-bold mb-1">Your Move</div>
                                                                    <p className="text-xs text-slate-300 leading-relaxed font-bold pl-2 border-l-2 border-green-500/20">{game.userMove ?? 'General Market Entry'}</p>
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] uppercase tracking-wider text-red-500/80 font-bold mb-1">Competitor Counter</div>
                                                                    <p className="text-xs text-slate-300 leading-relaxed font-bold pl-2 border-l-2 border-red-500/20">{game.competitorCounterMove ?? game.likelyMove}</p>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3">Projected Timeline</div>
                                                                    <div className="space-y-3 border-l border-slate-800 ml-1.5 pl-4">
                                                                        {[{ l: 'T+30 Days', v: game.timeline.T30 }, { l: 'T+90 Days', v: game.timeline.T90 }, { l: 'T+180 Days', v: game.timeline.T180 }].map((t, i) => (
                                                                            <div key={i} className="relative">
                                                                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-800 border-2 border-slate-600"></div>
                                                                                <div className="text-[10px] text-blue-400 font-bold mb-0.5 uppercase">{t.l}</div>
                                                                                <div className="text-[11px] text-slate-300 leading-snug">{t.v || 'No visible activity expected'}</div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Vulnerabilities</div>
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <div className="text-[10px] text-red-400 font-bold mb-1">High Risk (Copyable)</div>
                                                                            <ul className="text-[11px] text-slate-400 space-y-0.5 ml-2">
                                                                                {game.copyableFeatures?.map((f, i) => <li key={i}>• {f}</li>)}
                                                                            </ul>
                                                                        </div>
                                                                        <div>
                                                                            <div className="text-[10px] text-green-400 font-bold mb-1">Defensible</div>
                                                                            <ul className="text-[11px] text-slate-400 space-y-0.5 ml-2">
                                                                                {game.uncopyableFeatures?.map((f, i) => <li key={i}>• {f}</li>)}
                                                                            </ul>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {activeTab === 'comparison' && (
                                                <div className="space-y-4">
                                                    {results.comparisons?.map((comp, idx) => (
                                                        <div key={idx} className="p-4 bg-slate-800/20 rounded-lg border border-slate-700 shadow-sm">
                                                            <h4 className="text-sm font-bold text-white uppercase tracking-wide mb-4">{comp.competitor}</h4>
                                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                                <div className="bg-emerald-900/10 border border-emerald-500/20 p-3 rounded-lg">
                                                                    <div className="text-[10px] text-emerald-400 font-bold uppercase mb-2">Strengths</div>
                                                                    <ul className="text-[11px] text-slate-300 space-y-1 ml-2">
                                                                        {comp.strengths.map((s, i) => <li key={i}>→ {s}</li>)}
                                                                    </ul>
                                                                </div>
                                                                <div className="bg-red-900/10 border border-red-500/20 p-3 rounded-lg">
                                                                    <div className="text-[10px] text-red-400 font-bold uppercase mb-2">Weaknesses</div>
                                                                    <ul className="text-[11px] text-slate-300 space-y-1 ml-2">
                                                                        {comp.weaknesses.map((w, i) => <li key={i}>→ {w}</li>)}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                            <div className="bg-slate-900/40 border border-slate-700/50 rounded-lg overflow-hidden">
                                                                <table className="w-full text-left text-[11px]">
                                                                    <thead className="bg-slate-800/50 border-b border-slate-700 text-slate-400 uppercase tracking-wider">
                                                                        <tr>
                                                                            <th className="px-3 py-2 font-bold">Category</th>
                                                                            <th className="px-3 py-2 font-bold text-center">User</th>
                                                                            <th className="px-3 py-2 font-bold text-center">Comp</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-800">
                                                                        {comp.benchmarks.map((b, i) => (
                                                                            <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                                                                <td className="px-3 py-2.5 text-slate-300 font-semibold">{b.category}</td>
                                                                                <td className="px-3 py-2.5 text-center text-blue-400 font-bold">{b.userScore}</td>
                                                                                <td className="px-3 py-2.5 text-center text-indigo-400 font-bold">{b.competitorScore}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {activeTab === 'moat' && (
                                                <div className="space-y-4">
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                            <h4 className="text-xs font-bold text-green-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                                <i className="fas fa-shield-alt"></i> Green Flags
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {results.moat.greenFlags?.map((flag, i) => (
                                                                    <div key={i} className="bg-slate-900/50 p-2.5 rounded border border-green-900/20">
                                                                        <div className="font-semibold text-[11px] text-slate-200">{flag.feature}</div>
                                                                        <div className="text-[10px] text-slate-400 mt-1">{flag.rationale}</div>
                                                                        <div className="text-[10px] text-green-500 font-mono mt-1.5 flex items-center gap-1.5">
                                                                            <i className="fas fa-clock"></i> {flag.leadTime}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                            <h4 className="text-xs font-bold text-red-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                                <i className="fas fa-exclamation-triangle"></i> Red Flags
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {results.moat.redFlags?.map((flag, i) => (
                                                                    <div key={i} className="bg-slate-900/50 p-2.5 rounded border border-red-900/20">
                                                                        <div className="font-semibold text-[11px] text-slate-200">{flag.feature}</div>
                                                                        <div className="text-[10px] text-slate-400 mt-1">{flag.rationale}</div>
                                                                        <div className="text-[10px] text-red-500 font-mono mt-1.5 flex items-center gap-1.5">
                                                                            <i className="fas fa-stopwatch"></i> {flag.copyTime}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                        <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                                                            <i className="fas fa-lightbulb"></i> Strategic Recommendation
                                                        </h4>
                                                        <p className="text-xs text-slate-300 leading-relaxed font-bold">{results.moat.strategicPivot}</p>
                                                    </div>
                                                </div>
                                            )}

                                            {activeTab === 'citations' && (
                                                <div className="space-y-2">
                                                    {results.citations.map((citation, idx) => (
                                                        <div key={idx} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors">
                                                            <div className="font-bold text-xs text-slate-200 mb-0.5">{citation.competitor}</div>
                                                            <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-tighter">{citation.section}</div>
                                                            <a href={citation.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1.5 text-[10px] font-bold">
                                                                <i className="fas fa-external-link-alt text-[9px]"></i> View filing source
                                                            </a>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {activeTab === 'recommendations' && (
                                                <div className="space-y-3">
                                                    <div className="p-4 bg-slate-800/40 rounded-lg border border-slate-700/50">
                                                        <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-widest"><i className="fas fa-lightbulb text-yellow-400"></i> AI Top recommendations</h4>
                                                        <div className="space-y-2">
                                                            {results.recommendations?.map((rec, idx) => (
                                                                <div key={idx} className="flex items-start gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                                                                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold shrink-0 mt-0.5 border border-blue-500/20">{idx + 1}</span>
                                                                    <p className="text-xs text-slate-300 font-bold leading-relaxed">{rec}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 shrink-0">
                    {step === 'input' && (
                        <>
                            <button onClick={onClose} className="px-6 py-2.5 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleStartAnalysis}
                                disabled={competitors.length === 0}
                                className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black uppercase tracking-[0.15em] rounded-xl shadow-lg shadow-blue-900/20 disabled:opacity-50 transition-all active:scale-95"
                            >
                                Start Analysis ({competitors.length})
                            </button>
                        </>
                    )}

                    {step === 'processing' && (
                        <div className="w-full text-center text-slate-400 text-xs font-bold uppercase tracking-widest py-2">
                            System executing simulation...
                        </div>
                    )}

                    {step === 'results' && (
                        <div className="w-full flex items-center justify-between">
                            <div className="flex items-start gap-2 max-w-[50%] opacity-60">
                                <i className="fas fa-shield-halved text-blue-400 text-xs mt-0.5 shrink-0"></i>
                                <p className="text-[10px] text-slate-500 leading-tight font-medium uppercase tracking-tight">
                                    Simulation based on public filings and recent data signals.
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setStep('input')}
                                    className="px-5 py-2.5 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-2"
                                >
                                    <i className="fas fa-edit"></i> Edit Inputs
                                </button>
                                <button
                                    onClick={() => {
                                        setCompetitors([]);
                                        setResults(null);
                                        setUserContext('');
                                        setProgress(0);
                                        setStep('input');
                                    }}
                                    className="px-5 py-2.5 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-2"
                                >
                                    <i className="fas fa-plus"></i> New Analysis
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-8 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black uppercase tracking-[0.15em] rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CONFIRMATION MODALS */}
            <ConfirmationModal
                isOpen={!!pendingLoadAnalysis}
                onClose={() => setPendingLoadAnalysis(null)}
                onConfirm={confirmLoadAnalysis}
                title="Load Historical Analysis"
                message={`Are you sure you want to load the analysis for "${pendingLoadAnalysis?.competitors?.join(', ')}"? Current unsaved inputs will be discarded.`}
                confirmLabel="Load Analysis"
            />

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDelete}
                title={itemIdToDelete ? "Delete Analysis" : "Delete Selected Analyses"}
                message={itemIdToDelete
                    ? "Are you sure you want to permanently delete this analysis? This action cannot be undone."
                    : `Are you sure you want to delete ${selectedHistoryIds.length} analyses? This action cannot be undone.`
                }
                confirmLabel="Delete"
                isDestructive={true}
            />

            <ConfirmationModal
                isOpen={isAbortModalOpen}
                onClose={() => setIsAbortModalOpen(false)}
                onConfirm={confirmAbort}
                title="Abort Analysis"
                message="Are you sure you want to abort the current simulation? Your inputs will be saved to history so you can resume later."
                confirmLabel="Abort Analysis"
                isDestructive={true}
            />
        </div>
    );
};
