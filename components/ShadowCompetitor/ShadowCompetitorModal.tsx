import React, { useState, useEffect } from 'react';
import { detectGeography, getRegionFlag, getConfidenceColor, GeographyDetection, Region, RegulatoryBody } from '../../services/shadowCompetitor/geographyDetector';
import { shadowCompetitorOrchestrator, CompetitorInput, AnalysisResult } from '../../services/shadowCompetitor/orchestrator';
import { exportToCSV, exportToJSON, exportToPDF } from '../../services/shadowCompetitor/exportService';
import { projectService } from '../../services/projectService';
import MarkdownRenderer from '../MarkdownRenderer';

type ModalStep = 'input' | 'processing' | 'results';
type ResultTab = 'dna' | 'wargaming' | 'moat' | 'citations';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    domainInput: string;
    projectId?: string | null;
}

export const ShadowCompetitorModal: React.FC<Props> = ({ isOpen, onClose, domainInput, projectId }) => {
    const [step, setStep] = useState<ModalStep>('input');
    const [competitors, setCompetitors] = useState<Array<{ name: string; geography: GeographyDetection }>>([]);
    const [currentInput, setCurrentInput] = useState('');
    const [history, setHistory] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen && projectId && step === 'input') {
            projectService.getShadowAnalysisHistory(projectId).then(setHistory).catch(console.error);
        }
    }, [isOpen, projectId, step]);

    const handleLoadAnalysis = (item: any) => {
        if (confirm('Load this historical analysis? Current unsaved inputs will be lost.')) {
            setResults(item.result);
            setCompetitors(item.competitors.map((c: string) => ({
                name: c,
                geography: { region: 'US', regulatoryBody: 'SEC', confidence: 'High', confidenceScore: 100, signals: [] } // Mock geo for history
            })));
            setStep('results');
        }
    };

    // Processing state
    const [currentPhase, setCurrentPhase] = useState(1);
    const [currentCompetitor, setCurrentCompetitor] = useState('');
    const [statusText, setStatusText] = useState('');
    const [progress, setProgress] = useState(0);
    const [isPaused, setIsPaused] = useState(false);

    // Results state
    const [results, setResults] = useState<AnalysisResult | null>(null);
    const [activeTab, setActiveTab] = useState<ResultTab>('dna');

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
                domainInput,
                (phase, competitor, status, prog) => {
                    setCurrentPhase(phase);
                    setCurrentCompetitor(competitor);
                    setStatusText(status);
                    setProgress(prog);
                }
            );

            setResults(result);
            setResults(result);
            setStep('results');

            // Auto-Save
            if (projectId) {
                projectService.saveShadowAnalysis(projectId, result, competitors.map(c => c.name))
                    .then(() => projectService.getShadowAnalysisHistory(projectId).then(setHistory))
                    .catch(e => console.error("Failed to auto-save:", e));
            }
        } catch (error) {
            console.error('Analysis failed:', error);
            alert('Analysis failed. Please try again.');
            setStep('input');
        }
    };

    const handlePauseResume = () => {
        if (isPaused) {
            shadowCompetitorOrchestrator.resume();
            setIsPaused(false);
        } else {
            shadowCompetitorOrchestrator.pause();
            setIsPaused(true);
        }
    };

    if (!isOpen) return null;

    const regulatoryBodies = [...new Set(competitors.map(c => c.geography.regulatoryBody))].join(', ');

    return (
        <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="relative w-full max-w-5xl max-h-[90vh] bg-slate-900 rounded-xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700 shrink-0 bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-900/30 flex items-center justify-center border border-blue-500/30">
                            <i className="fas fa-project-diagram text-xl text-blue-400"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">
                                Competitive Intelligence
                            </h2>
                            <p className="text-xs text-slate-400">
                                {step === 'input' && 'Step 1: Select Competitors'}
                                {step === 'processing' && `Phase ${currentPhase} of 3: Processing`}
                                {step === 'results' && 'Analysis Results'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-white transition-colors"
                    >
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* INPUT STEP */}
                    {step === 'input' && (
                        <div className="grid grid-cols-4 gap-6 h-full min-h-[400px]">
                            {/* Left Sidebar: History */}
                            <div className="col-span-1 border-r border-slate-700/50 pr-4 flex flex-col h-full">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
                                    <i className="fas fa-history mr-2"></i> History
                                </h3>

                                {history.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/50">
                                        <i className="fas fa-ghost text-slate-600 mb-2"></i>
                                        <p className="text-[10px] text-slate-500">No previous analyses</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                        {history.map((item) => (
                                            <button
                                                key={item.id}
                                                onClick={() => handleLoadAnalysis(item)}
                                                className="w-full text-left p-3 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-600 transition-all group relative"
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-[10px] text-slate-500 font-mono">
                                                        {new Date(item.timestamp).toLocaleDateString()}
                                                    </span>
                                                    <i className="fas fa-chevron-right text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                                                </div>
                                                <div className="text-xs font-semibold text-slate-300 line-clamp-2 leading-tight group-hover:text-blue-400 transition-colors">
                                                    {item.competitors.join(', ')}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Right Panel: Input Form */}
                            <div className="col-span-3 space-y-4">
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
                                    <div className="flex gap-3">
                                        <input
                                            type="text"
                                            value={currentInput}
                                            onChange={(e) => setCurrentInput(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && handleAddCompetitor()}
                                            placeholder="e.g., Salesforce Inc., Infosys Limited..."
                                            className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
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

                                {/* Competitor List */}
                                {competitors.length > 0 && (
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                {competitors.length} {competitors.length === 1 ? 'Company' : 'Companies'}
                                            </label>
                                            <span className="text-[10px] text-blue-400 font-medium">
                                                {regulatoryBodies}
                                            </span>
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

                                                                <div className="flex items-center gap-2 text-xs mb-2">
                                                                    <span className="text-lg">{getRegionFlag(comp.geography.region)}</span>
                                                                    <span className="text-slate-400">
                                                                        {comp.geography.region} • {comp.geography.regulatoryBody}
                                                                    </span>
                                                                </div>

                                                                {comp.geography.signals.length > 0 && (
                                                                    <div className="text-[10px] text-slate-500">
                                                                        {comp.geography.signals.map((signal, i) => (
                                                                            <div key={i} className="flex items-center gap-1">
                                                                                <i className="fas fa-check text-[8px] text-blue-500"></i>
                                                                                <span>{signal.description}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <select
                                                                    value={`${comp.geography.region}|${comp.geography.regulatoryBody}`}
                                                                    onChange={(e) => {
                                                                        const [region, body] = e.target.value.split('|');
                                                                        handleGeographyOverride(idx, region as Region, body as RegulatoryBody);
                                                                    }}
                                                                    className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
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
                        </div>
                    )}

                    {/* PROCESSING STEP */}
                    {step === 'processing' && (
                        <div className="space-y-6">
                            {/* Overall Status */}
                            <div className="text-center py-8">
                                <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                <h3 className="text-lg font-semibold text-white mb-2">Processing Analysis</h3>
                                <p className="text-sm text-slate-400">{statusText}</p>
                                <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 mt-3">
                                    <i className="fas fa-database text-blue-400"></i>
                                    <span>Sources: {regulatoryBodies}</span>
                                </div>
                            </div>

                            {/* Processing Status */}
                            <div className="p-4 bg-slate-800/30 border border-slate-700 rounded-lg">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
                                    <i className="fas fa-tasks mr-2"></i>
                                    Progress
                                </h4>

                                <div className="space-y-3">
                                    {[1, 2, 3].map(phase => (
                                        <div key={phase} className={`p-3 rounded-lg border text-sm ${currentPhase === phase ? 'bg-blue-900/10 border-blue-600' : currentPhase > phase ? 'bg-emerald-900/10 border-emerald-700/30' : 'bg-slate-900/20 border-slate-700/30'}`}>
                                            <div className="flex items-center gap-2 mb-1.5">
                                                {currentPhase > phase && <i className="fas fa-check-circle text-emerald-400 text-sm"></i>}
                                                {currentPhase === phase && <i className="fas fa-spinner fa-spin text-blue-400 text-sm"></i>}
                                                {currentPhase < phase && <i className="fas fa-clock text-slate-600 text-sm"></i>}
                                                <span className="font-semibold text-white text-sm">
                                                    Phase {phase}: {phase === 1 ? 'Data Collection' : phase === 2 ? 'Analysis' : 'Validation'}
                                                </span>
                                            </div>
                                            {currentPhase === phase && (
                                                <div className="ml-6">
                                                    <p className="text-xs text-slate-400 mb-1.5">{statusText}</p>
                                                    <div className="w-full bg-slate-700/50 rounded-full h-1.5">
                                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 text-center">
                                    <button
                                        onClick={handlePauseResume}
                                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-sm font-semibold flex items-center gap-2 mx-auto transition-colors"
                                    >
                                        <i className={`fas fa-${isPaused ? 'play' : 'pause'} text-xs`}></i>
                                        {isPaused ? 'Resume' : 'Pause'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* RESULTS STEP */}
                    {step === 'results' && results && (
                        <div className="space-y-4">
                            {/* Success Banner with Export */}
                            <div className="p-4 bg-slate-800/20 border border-slate-700 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
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
                                            <i className="fas fa-file-pdf text-[10px] text-red-400"></i> PDF
                                        </button>
                                        <button onClick={() => exportToCSV(results.dna, results.warGaming)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors">
                                            <i className="fas fa-file-csv text-[10px] text-green-400"></i> CSV
                                        </button>
                                        <button onClick={() => exportToJSON(results)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 transition-colors">
                                            <i className="fas fa-code text-[10px] text-purple-400"></i> JSON
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex items-center gap-1 border-b border-slate-700 -mx-4 px-4">
                                {[
                                    { id: 'dna' as ResultTab, label: 'Overview', icon: 'fa-chart-line' },
                                    { id: 'wargaming' as ResultTab, label: 'Timeline', icon: 'fa-calendar-alt' },
                                    { id: 'moat' as ResultTab, label: 'Validation', icon: 'fa-shield-alt' },
                                    { id: 'citations' as ResultTab, label: 'Sources', icon: 'fa-link' }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`px-4 py-2.5 text-xs font-semibold transition-all ${activeTab === tab.id
                                            ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-900/10'
                                            : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/30'
                                            }`}
                                    >
                                        <i className={`fas ${tab.icon} mr-1.5 text-[10px]`}></i>
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700 max-h-96 overflow-y-auto">
                                {activeTab === 'dna' && (
                                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                                        {results.dna.map((d, idx) => (
                                            <div key={idx} className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                                                            {d.name}
                                                        </h4>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[10px] text-slate-400 font-medium tracking-wide">COMPETITOR PROFILE</span>
                                                            {d.confidence && (
                                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${d.confidence.level === 'High' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                                                    d.confidence.level === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                                                                        'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                                                    }`}>
                                                                    <i className={`fas fa-${d.confidence.level === 'High' ? 'check-circle' : d.confidence.level === 'Medium' ? 'minus-circle' : 'exclamation-triangle'} mr-1`}></i>
                                                                    {d.confidence.level} Confidence
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Risk Badge - STRICTLY enforces short label */}
                                                    <div className="flex flex-col items-end">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${(d.riskAppetite?.toString().toLowerCase().includes('high')) ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                            (d.riskAppetite?.toString().toLowerCase().includes('medium')) ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                                                                'bg-green-500/10 text-green-400 border border-green-500/20'
                                                            }`}>
                                                            {d.riskAppetite?.toString().split(/[-–:]/)[0].substring(0, 10) || 'Medium'} Risk
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 mb-4">
                                                    <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Financial Power</div>
                                                        <div className="flex flex-col gap-1.5">
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
                                                        {/* Changed from pills to list for better readability of long text */}
                                                        <ul className="space-y-1.5 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                                                            {d.technicalMoats?.length ? d.technicalMoats.map((moat, i) => (
                                                                <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                                                    <i className="fas fa-shield-alt text-[10px] text-blue-500 mt-0.5 shrink-0"></i>
                                                                    <span className="leading-relaxed text-[11px]">
                                                                        {typeof moat === 'string' ? moat : (moat as any).Moat || 'Moat'}
                                                                    </span>
                                                                </li>
                                                            )) : <li className="text-xs text-slate-500 italic">None identified</li>}
                                                        </ul>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-900/30 p-3 rounded border border-slate-700/30">
                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Strategic Priorities</div>
                                                    <ul className="space-y-1.5">
                                                        {d.strategicCommitment?.length ? d.strategicCommitment.map((item, i) => (
                                                            <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                                                <i className="fas fa-bullseye text-[10px] text-blue-500 mt-0.5 shrink-0"></i>
                                                                <span className="leading-relaxed text-[11px]">
                                                                    {typeof item === 'string' ? item : (item as any).Priority || 'Priority'}
                                                                </span>
                                                            </li>
                                                        )) : <li className="text-xs text-slate-500 italic">Data unavailable</li>}
                                                    </ul>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'citations' && (
                                    <div className="space-y-3 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                                        <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-2">
                                                <i className="fas fa-link text-blue-500"></i> Verified Filing Sources
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {results.citations.map((citation, idx) => (
                                                    <div key={idx} className="p-2.5 bg-slate-900/50 rounded border border-slate-700/50 hover:border-slate-600 transition-colors">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <div className="font-bold text-xs text-slate-200 mb-0.5">{citation.competitor}</div>
                                                                <div className="text-[10px] text-slate-400 mb-1.5">{citation.section}</div>
                                                            </div>
                                                            <div className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500 uppercase tracking-wide">
                                                                Source
                                                            </div>
                                                        </div>
                                                        <a
                                                            href={citation.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1.5 text-[10px] font-medium mt-1"
                                                        >
                                                            <i className="fas fa-external-link-alt text-[9px]"></i>
                                                            {citation.url}
                                                        </a>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'wargaming' && (
                                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                                        {results.warGaming.map((game, idx) => (
                                            <div key={idx} className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                                                            {game.competitor}
                                                        </h4>
                                                        <span className="text-[10px] text-slate-400 font-medium tracking-wide">WAR-GAME SIMULATION</span>
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${game.probability === 'High' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                        game.probability === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                                                            'bg-green-500/10 text-green-400 border border-green-500/20'
                                                        }`}>
                                                        {game.probability} Probability
                                                    </span>
                                                </div>

                                                <div className="bg-slate-900/30 p-3 rounded border border-slate-700/30 mb-4">
                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Likely Strategic Move</div>
                                                    <p className="text-xs text-slate-300 leading-relaxed font-medium">{game.likelyMove}</p>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-3">Projected Timeline</div>
                                                        <div className="space-y-4 relative border-l border-slate-800 ml-1.5 pl-4">
                                                            {[
                                                                { l: 'T+30 Days', v: game.timeline.T30 },
                                                                { l: 'T+90 Days', v: game.timeline.T90 },
                                                                { l: 'T+180 Days', v: game.timeline.T180 }
                                                            ].map((t, i) => (
                                                                <div key={i} className="relative">
                                                                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-800 border-2 border-slate-600"></div>
                                                                    <div className="text-[10px] text-blue-400 font-bold mb-0.5 uppercase tracking-wide">{t.l}</div>
                                                                    <div className="text-[11px] text-slate-300 leading-snug">{t.v || 'No visible activity expected'}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="p-3 bg-slate-900/50 rounded border border-slate-700/50">
                                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Feature Vulnerability</div>
                                                        <div className="space-y-4">
                                                            <div>
                                                                <div className="text-[10px] text-red-400 font-bold mb-1.5 flex items-center gap-1.5">
                                                                    <i className="fas fa-times-circle"></i> High Risk (Copyable)
                                                                </div>
                                                                <ul className="space-y-1">
                                                                    {game.copyableFeatures?.length ? game.copyableFeatures.map((f, i) => (
                                                                        <li key={i} className="text-[11px] text-slate-400 pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-slate-600">
                                                                            {f}
                                                                        </li>
                                                                    )) : <li className="text-[11px] text-slate-500 italic">None identified</li>}
                                                                </ul>
                                                            </div>
                                                            <div>
                                                                <div className="text-[10px] text-green-400 font-bold mb-1.5 flex items-center gap-1.5">
                                                                    <i className="fas fa-check-circle"></i> Defensible (Hard to Copy)
                                                                </div>
                                                                <ul className="space-y-1">
                                                                    {game.uncopyableFeatures?.length ? game.uncopyableFeatures.map((f, i) => (
                                                                        <li key={i} className="text-[11px] text-slate-400 pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-slate-600">
                                                                            {f}
                                                                        </li>
                                                                    )) : <li className="text-[11px] text-slate-500 italic">None identified</li>}
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'moat' && (
                                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                <h4 className="text-xs font-bold text-green-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                    <i className="fas fa-shield-alt"></i> Green Flags (Defensible)
                                                </h4>
                                                {results.moat.greenFlags?.length ? (
                                                    <div className="space-y-2">
                                                        {results.moat.greenFlags.map((flag, i) => (
                                                            <div key={i} className="bg-slate-900/50 p-2.5 rounded border border-green-900/20">
                                                                <div className="font-semibold text-[11px] text-slate-200">{flag.feature}</div>
                                                                <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">{flag.rationale}</div>
                                                                <div className="text-[10px] text-green-500 font-mono mt-1.5 flex items-center gap-1.5">
                                                                    <i className="fas fa-clock"></i> Lead time: {flag.leadTime}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-[11px] text-slate-500 italic">No defensible moats identified.</p>
                                                )}
                                            </div>

                                            <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                                <h4 className="text-xs font-bold text-red-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                    <i className="fas fa-exclamation-triangle"></i> Red Flags (Vulnerable)
                                                </h4>
                                                {results.moat.redFlags?.length ? (
                                                    <div className="space-y-2">
                                                        {results.moat.redFlags.map((flag, i) => (
                                                            <div key={i} className="bg-slate-900/50 p-2.5 rounded border border-red-900/20">
                                                                <div className="font-semibold text-[11px] text-slate-200">{flag.feature}</div>
                                                                <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">{flag.rationale}</div>
                                                                <div className="text-[10px] text-red-500 font-mono mt-1.5 flex items-center gap-1.5">
                                                                    <i className="fas fa-stopwatch"></i> Copy time: {flag.copyTime}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-[11px] text-slate-500 italic">No critical vulnerabilities identified.</p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="p-4 bg-slate-800/20 rounded-lg border border-slate-700">
                                            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                                                <i className="fas fa-lightbulb"></i> Strategic Recommendation
                                            </h4>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                {results.moat.strategicPivot}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3">
                    {step === 'input' && (
                        <>
                            <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm font-semibold transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleStartAnalysis}
                                disabled={competitors.length === 0}
                                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 disabled:opacity-50 transition-all"
                            >
                                Start Analysis ({competitors.length})
                            </button>
                        </>
                    )}

                    {step === 'processing' && (
                        <div className="w-full text-center text-slate-400 text-sm">
                            <i className="fas fa-spinner fa-spin mr-2"></i>
                            Processing... {Math.round(progress)}%
                        </div>
                    )}

                    {step === 'results' && (
                        <div className="w-full flex items-center justify-between">
                            <div className="flex items-start gap-2 max-w-[60%] opacity-70 hover:opacity-100 transition-opacity">
                                <i className="fas fa-exclamation-circle text-amber-500 text-[10px] mt-0.5 shrink-0"></i>
                                <p className="text-[10px] text-slate-500 leading-tight font-medium">
                                    <span className="font-bold uppercase tracking-wider text-slate-400 mr-1">Guardrail Warning:</span>
                                    Simulation based on public data. Verify critical strategic details.
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        setStep('input');
                                        setResults(null);
                                        setCompetitors([]);
                                    }}
                                    className="px-4 py-2 text-slate-400 hover:text-white text-sm font-semibold transition-colors"
                                >
                                    <i className="fas fa-arrow-left mr-1 text-xs"></i>
                                    New Analysis
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 transition-all"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};
