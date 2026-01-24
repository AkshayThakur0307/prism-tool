import React, { useState, useEffect, useRef } from 'react';
import { DiscoveryStage, ProjectMetadata, FileContext } from '../../types';
import { PersonaRole, SessionState, InteractionEvent, PersonaAgent, WarRoomContext } from '../../types/warRoom';
import { PersonaRegistry } from '../../services/warRoom/personaRegistry';
import { Moderator } from '../../services/warRoom/moderator';
import { SessionSummaryModal } from './SessionSummaryModal';
import { WarRoomSetup } from './WarRoomSetup';
import { ElevenLabsService } from '../../services/elevenLabsService';

interface VirtualWarRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentStage: DiscoveryStage;
    projectContext: ProjectMetadata; // Legacy prop (keeping for compatibility but stageContext covers it)
    userName?: string;
    stageContext: WarRoomContext; // NEW: Detailed context
    projectId: string; // NEW: For scoped persistence
}

export const VirtualWarRoomModal: React.FC<VirtualWarRoomModalProps> = ({
    isOpen, onClose, currentStage, projectContext, userName = 'Strategist', stageContext, projectId
}) => {
    const [isConfiguring, setIsConfiguring] = useState(true);
    const [activeAgents, setActiveAgents] = useState<PersonaAgent[]>([]);

    const [sessionstate, setSessionState] = useState<SessionState>({
        id: crypto.randomUUID(),
        startTime: Date.now(),
        isActive: false,
        activeStage: currentStage,
        participants: [], // Will be filled by Setup
        transcript: [],
        panelSentimentScore: 50,
        contextFiles: []
    });

    const [isThinking, setIsThinking] = useState(false);
    const [currentInput, setCurrentInput] = useState('');
    const [permissionGranted, setPermissionGranted] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [isContextSynced, setIsContextSynced] = useState(true);
    const [showAddAgentModal, setShowAddAgentModal] = useState(false);

    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        // Validate size (e.g., 5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            alert("File is too large. Max 5MB.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            // Extract base64 clean data
            const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

            const contextFile: FileContext = {
                name: file.name,
                content: cleanBase64,
                mimeType: file.type,
                size: file.size
            };

            setSessionState(prev => ({
                ...prev,
                contextFiles: [...(prev.contextFiles || []), contextFile],
                transcript: [
                    ...prev.transcript,
                    {
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        speakerRole: 'STRATEGIST',
                        speakerName: 'SYSTEM',
                        content: `[SYSTEM] Shared new context file: ${file.name}`,
                    } as InteractionEvent
                ]
            }));
        };
        reader.readAsDataURL(file);
    };

    // Auto-scroll
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [sessionstate.transcript]);

    // Auto-Save Session on Change (Debounced or on Unmount logic)
    // For simplicity, we save whenever transcript updates if the session is valid
    useEffect(() => {
        if (sessionstate.transcript.length > 0) {
            // MIGRATED TO FIREBASE
            const saveSession = async () => {
                try {
                    const { projectService } = await import('../../services/projectService');
                    await projectService.saveWarRoomSession(projectId, sessionstate);
                } catch (error) {
                    console.error("Failed to auto-save session:", error);
                }
            };
            saveSession();
        }
    }, [sessionstate, projectId]);

    const [recursionDepth, setRecursionDepth] = useState(0);

    // Dedicated function to handle the end of a turn
    const handleTurnComplete = (finalState: SessionState) => {
        setSessionState(prev => ({ ...prev, currentTurn: undefined }));
        setIsThinking(false); // Always stop thinking after a turn completes

        // Check if we should continue the debate (Recursive Turn)
        if (finalState.pendingInterjection === 'MODERATOR') {
            if (recursionDepth < 3) { // SAFETY: Max 3 auto-turns to prevent infinite loops
                const lastMsg = finalState.transcript[finalState.transcript.length - 1];
                console.log("[WarRoom] Auto-triggering debate response to:", lastMsg.speakerRole);

                // Wait a moment for natural pause, then trigger
                setTimeout(() => {
                    setRecursionDepth(prev => prev + 1);
                    handleSendMessage(lastMsg.content, true); // true = isRecursive
                }, 800);
            } else {
                console.log("[WarRoom] Max recursion reached. Stopping auto-debate.");
                setRecursionDepth(0); // Reset for next user interaction
            }
        } else {
            setRecursionDepth(0); // Reset if chain breaks
        }
    };

    const handleSendMessage = async (textOverride?: string, isRecursive: boolean = false) => {
        const input = typeof textOverride === 'string' ? textOverride : currentInput;
        if (!input?.trim()) return;

        setIsThinking(true);
        if (!textOverride && !isRecursive) setCurrentInput('');

        // If this is a user input, reset recursion depth
        if (!isRecursive && !textOverride) setRecursionDepth(0);

        try {
            // Determine context based on sync toggle
            const effectiveContext = isContextSynced ? stageContext : {
                stageInput: '',
                stageOutput: '',
                projectMetadata: stageContext.projectMetadata
            };

            const updatedState = await Moderator.processInteraction(
                input,
                sessionstate,
                currentStage,
                effectiveContext,
                activeAgents // Use user-selected agents
            );

            setSessionState(updatedState);

            const lastMessage = updatedState.transcript[updatedState.transcript.length - 1];
            if (lastMessage && lastMessage.speakerRole !== 'STRATEGIST') {
                const agent = activeAgents.find(a => a.role === lastMessage.speakerRole);

                console.log(`[WarRoom] Speaker: ${lastMessage.speakerRole}, Agent Found: ${!!agent}, VoiceID: ${agent?.voiceId}`);

                if (agent?.voiceId) {
                    // Trigger audio and clear turn when done
                    console.log(`[WarRoom] Triggering ElevenLabs for ${agent.name}`);
                    ElevenLabsService.speak(lastMessage.content, agent.voiceId)
                        .then(() => handleTurnComplete(updatedState))
                        .catch((err) => {
                            console.error(err);
                            handleTurnComplete(updatedState); // Ensure we continue even on audio fail
                        });
                } else if ('speechSynthesis' in window) {
                    console.warn(`[WarRoom] No Voice ID for ${lastMessage.speakerRole}. Using Browser TTS.`);
                    const utterance = new SpeechSynthesisUtterance(lastMessage.content);
                    utterance.onend = () => handleTurnComplete(updatedState);
                    window.speechSynthesis.speak(utterance);
                } else {
                    // Fallback if no audio at all
                    setTimeout(() => handleTurnComplete(updatedState), 2000);
                }
            } else {
                // If no agent responded (e.g., Strategist spoke, or no new agent message),
                // or if the last message was from the Strategist, just complete the turn.
                handleTurnComplete(updatedState);
            }

        } catch (error) {
            console.error("War Room Error:", error);
            setIsThinking(false);
        }
    };

    // Voice Setup
    useEffect(() => {
        if ('webkitSpeechRecognition' in window) {
            const SpeechRecognition = (window as any).webkitSpeechRecognition;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event: any) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        handleSendMessage(event.results[i][0].transcript);
                    }
                }
            };

            recognitionRef.current.onstart = () => setPermissionGranted(true);
            recognitionRef.current.onend = () => {
                if (sessionstate.isActive && !isThinking) {
                    setSessionState(prev => ({ ...prev, isActive: false }));
                }
            };
        }
    }, [sessionstate.isActive, isThinking, activeAgents]); // Added activeAgents to update closure

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            ElevenLabsService.stop();
        };
    }, []);

    const handleStopSession = () => {
        setSessionState(prev => ({ ...prev, isActive: false }));
        recognitionRef.current?.stop();
        ElevenLabsService.stop();
    };

    const toggleSession = () => {
        if (sessionstate.isActive) {
            handleStopSession();
        } else {
            setSessionState(prev => ({ ...prev, isActive: true }));
            recognitionRef.current?.start();
        }
    };

    const handleEndSession = async () => {
        // Stop recording first
        handleStopSession();

        // If no discussion, just show summary immediately
        if (sessionstate.transcript.length === 0) {
            setSummaryContent("# Session Ended\n\nNo discussion took place in this session.");
            setShowSummary(true);
            return;
        }

        setIsSynthesizing(true);
        try {
            const summary = await Moderator.generateSessionSummary(sessionstate.transcript);
            setSummaryContent(summary);
            setShowSummary(true);
        } catch (e) {
            console.error("Synthesis failed", e);
        } finally {
            setIsSynthesizing(false);
        }
    };

    if (!isOpen) return null;

    const getAgentColor = (role: PersonaRole) => {
        switch (role) {
            case 'PRODUCT_MANAGER': return 'text-emerald-400 border-emerald-500/30 bg-emerald-900/10';
            case 'DELIVERY_MANAGER': return 'text-amber-400 border-amber-500/30 bg-amber-900/10';
            case 'ARCHITECT': return 'text-indigo-400 border-indigo-500/30 bg-indigo-900/10';
            case 'TECH_LEAD': return 'text-blue-400 border-blue-500/30 bg-blue-900/10';
            case 'LEAD_UX': return 'text-purple-400 border-purple-500/30 bg-purple-900/10'; // Purple for Design
            case 'END_USER': return 'text-pink-400 border-pink-500/30 bg-pink-900/10';
            case 'DEVELOPER': return 'text-cyan-400 border-cyan-500/30 bg-cyan-900/10';
            default: return 'text-slate-400 border-slate-500/30 bg-slate-900/10';
        }
    };

    // Helper to get color for custom agents
    const getDynamicAgentColor = (agent: PersonaAgent) => {
        if (agent.isCustom) return 'text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-900/10';
        return getAgentColor(agent.role as PersonaRole);
    };

    const getAgentIcon = (role: PersonaRole) => {
        switch (role) {
            case 'PRODUCT_MANAGER': return '👨‍💼';
            case 'ARCHITECT': return '📐';
            case 'TECH_LEAD': return '🛠️';
            case 'DELIVERY_MANAGER': return '⏱️';
            case 'LEAD_UX': return '🎨';
            case 'END_USER': return '👤';
            case 'DEVELOPER': return '💻';
            default: return '🤖';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
            {isConfiguring ? (
                <div className="w-full max-w-5xl h-[85vh] relative rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/5">
                    <WarRoomSetup
                        onStartSession={(selected) => {
                            setActiveAgents(selected);
                            setSessionState(prev => ({
                                ...prev,
                                participants: selected.map(a => a.role)
                            }));
                            setIsConfiguring(false);
                            // Auto-start active mode? Maybe wait for user to push mic.
                        }}
                        onResumeSession={(restoredSession) => {
                            // We need to restore 'activeAgents' too, but SessionState only stores Roles (strings).
                            // We must infer/lookup the agents from the Registry + Custom Store.
                            const allDefaults = PersonaRegistry.getAllPersonas();
                            const customJson = localStorage.getItem('war_room_custom_agents');
                            const custom: PersonaAgent[] = customJson ? JSON.parse(customJson) : [];
                            const allAvailable = [...allDefaults, ...custom];

                            const restoredAgents = restoredSession.participants.map(role => allAvailable.find(a => a.role === role)).filter(Boolean) as PersonaAgent[];

                            setActiveAgents(restoredAgents);
                            setSessionState(restoredSession);
                            setIsConfiguring(false);
                        }}
                        onCancel={onClose}
                        projectId={projectId}
                    />
                </div>
            ) : (
                <div className="w-full max-w-[90vw] h-[85vh] bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/5 relative">

                    {/* GLOBAL HEADER */}
                    <div className="h-16 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between px-8 shrink-0 relative z-20">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                                <i className="fas fa-chess-knight text-white text-lg"></i>
                            </div>
                            <div>
                                <h1 className="text-sm font-black text-white uppercase tracking-widest leading-none">Strategic War Room</h1>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Connected: Gemini 1.5 Pro</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-6">
                            {/* Context Sync Toggle */}
                            <div className="flex items-center gap-3 border-r border-slate-800 pr-6">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Stage Context</span>

                                {isContextSynced && (
                                    <span className="text-[9px] font-mono text-indigo-400 bg-indigo-900/30 px-2 py-0.5 rounded border border-indigo-500/30 animate-in fade-in zoom-in duration-300">
                                        {currentStage.replace(/_/g, ' ')}
                                    </span>
                                )}

                                <button
                                    onClick={() => setIsContextSynced(!isContextSynced)}
                                    className={`
                                    relative w-10 h-5 rounded-full transition-colors duration-300 focus:outline-none
                                    ${isContextSynced ? 'bg-indigo-600' : 'bg-slate-700'}
                                `}
                                    title={isContextSynced ? "Agents see current stage data" : "Agents are unaware of stage data"}
                                >
                                    <div className={`
                                    absolute top-1 left-1 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-300
                                    ${isContextSynced ? 'translate-x-5' : 'translate-x-0'}
                                `}></div>
                                </button>
                            </div>

                            <div className="flex flex-col items-end">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Panel Sentiment</span>
                                <div className="flex items-center gap-3">
                                    <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-700 ease-out ${sessionstate.panelSentimentScore > 60 ? 'bg-emerald-500' : sessionstate.panelSentimentScore < 40 ? 'bg-red-500' : 'bg-amber-500'}`}
                                            style={{ width: `${sessionstate.panelSentimentScore}%` }}
                                        ></div>
                                    </div>
                                    <span className="font-mono text-xs font-bold text-white">{Math.round(sessionstate.panelSentimentScore)}%</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleEndSession}
                                    disabled={isSynthesizing}
                                    className="h-8 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSynthesizing ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-flag-checkered"></i>}
                                    {isSynthesizing ? 'Synthesizing...' : 'End & Synthesize'}
                                </button>

                            </div>
                        </div>
                    </div>

                    <div className="flex-1 flex overflow-hidden relative">
                        {/* MAIN BOARDROOM VIEW (Agents) */}
                        <div className="flex-[3] relative bg-[url('https://res.cloudinary.com/dp653wzbb/image/upload/v1689230556/grid_bg_dark_zsd7i7.png')] bg-repeat bg-[length:50px_50px] flex flex-col">
                            <div className="absolute inset-0 bg-slate-950/80"></div>

                            {/* Agent Grid */}
                            <div className="relative z-10 flex-1 p-8 grid grid-cols-4 gap-6 content-center">
                                {activeAgents.map((agent, idx) => {
                                    const isSpeaking = sessionstate.currentTurn === agent.role;
                                    const style = getDynamicAgentColor(agent);
                                    return (
                                        <div
                                            key={agent.id}
                                            className={`w-full relative group transition-all duration-500 ${isSpeaking ? 'scale-105 z-20' : 'scale-100 opacity-80 hover:opacity-100'}`}
                                        >
                                            <div className={`
                                            absolute inset-0 rounded-2xl bg-gradient-to-b from-white/5 to-transparent blur-xl transition-opacity duration-500
                                            ${isSpeaking ? 'opacity-100' : 'opacity-0'}
                                        `}></div>

                                            <div className={`
                                            relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border p-5 flex flex-col items-center gap-3 transition-colors h-full
                                            ${isSpeaking ? 'border-indigo-500/50 shadow-2xl shadow-indigo-500/20' : 'border-slate-800 hover:border-slate-700'}
                                        `}>
                                                <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center text-2xl relative ${style.split(' ')[1]}`}>
                                                    <div className={`absolute inset-0 rounded-full border border-current opacity-20 ${isSpeaking ? 'animate-ping' : ''}`}></div>
                                                    <span className="grayscale group-hover:grayscale-0 transition-all">
                                                        {getAgentIcon(agent.role as PersonaRole)}
                                                    </span>
                                                </div>

                                                <div className="text-center">
                                                    <div className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${style.split(' ')[0]}`}>{agent.role}</div>
                                                    <div className="text-xs font-bold text-slate-300">{agent.name}</div>
                                                </div>

                                                {isSpeaking && (
                                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                                                        <span className="w-1 h-1 rounded-full bg-white animate-pulse"></span>
                                                        Speaking
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* USER CARD (My Card) */}
                                <div className={`w-full relative group transition-all duration-500 ${sessionstate.isActive ? 'scale-105 z-20' : 'scale-100 opacity-80 hover:opacity-100'}`}>
                                    <div className={`
                                    absolute inset-0 rounded-2xl bg-gradient-to-b from-indigo-500/10 to-transparent blur-xl transition-opacity duration-500
                                    ${sessionstate.isActive ? 'opacity-100' : 'opacity-0'}
                                `}></div>
                                    <div className={`
                                    relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border p-5 flex flex-col items-center gap-3 transition-colors h-full
                                    ${sessionstate.isActive ? 'border-indigo-400 shadow-2xl shadow-indigo-500/20' : 'border-slate-800 hover:border-slate-700'}
                                `}>
                                        <div className="w-16 h-16 rounded-full border-2 border-indigo-500/30 bg-indigo-900/10 flex items-center justify-center text-2xl relative">
                                            <div className={`absolute inset-0 rounded-full border border-current opacity-20 ${sessionstate.isActive ? 'animate-ping' : ''} text-indigo-400`}></div>
                                            <span>👤</span>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-black uppercase tracking-widest mb-0.5 text-indigo-400">YOU</div>
                                            <div className="text-xs font-bold text-slate-300">{userName}</div>
                                        </div>
                                        {sessionstate.isActive && (
                                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-indigo-500 text-white text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                                                <span className="w-1 h-1 rounded-full bg-white animate-pulse"></span>
                                                Listening
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* ADD AGENT SLOT (if < 7) */}
                                {activeAgents.length < 7 && (
                                    <div
                                        onClick={() => setShowAddAgentModal(true)}
                                        className="w-full relative z-30 group cursor-pointer opacity-60 hover:opacity-100 transition-all duration-300"
                                    >
                                        <div className="relative bg-slate-900/50 border border-dashed border-slate-700 hover:border-indigo-500/50 rounded-2xl p-5 flex flex-col items-center justify-center gap-3 h-full min-h-[160px]">
                                            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-indigo-600 transition-colors shadow-lg">
                                                <i className="fas fa-plus text-slate-400 group-hover:text-white"></i>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-500 group-hover:text-indigo-300 uppercase tracking-widest">Add Agent</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* User Control Bar (Bottom Center) */}
                            <div className="mt-auto relative z-20 pb-8 flex justify-center">
                                <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-2 rounded-2xl shadow-2xl flex items-center gap-2">
                                    <button
                                        onClick={toggleSession}
                                        className={`
                                        h-14 px-8 rounded-xl font-bold uppercase tracking-widest text-xs flex items-center gap-3 transition-all
                                        ${sessionstate.isActive
                                                ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20'
                                                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'}
                                    `}
                                    >
                                        <i className={`fas ${sessionstate.isActive ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                                        {sessionstate.isActive ? 'Stop Speaking' : 'Push to Talk'}
                                    </button>

                                    {sessionstate.isActive && (
                                        <div className="h-14 w-64 bg-slate-950 rounded-xl border border-slate-800 flex items-center px-4 relative overflow-hidden">
                                            <div className="flex gap-0.5 items-center absolute left-4 h-4">
                                                {[...Array(5)].map((_, i) => (
                                                    <div key={i} className="w-1 bg-indigo-500 rounded-full animate-music-bar" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
                                                ))}
                                            </div>
                                            <span className="ml-8 text-[10px] text-slate-400 font-mono uppercase truncate">Listening...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT SIDEBAR: TRANSCRIPT */}
                        <div className="w-[400px] border-l border-slate-800 bg-slate-950 flex flex-col shrink-0 z-20 h-full">
                            {/* Header */}
                            <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Session Transcript</span>
                                <span className="text-[10px] font-bold text-slate-600">{sessionstate.transcript.length} Events</span>
                            </div>

                            {/* Transcript Area - min-h-0 is crucial for nested flex scrolling */}
                            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar flex flex-col">
                                {sessionstate.transcript.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                                        <i className="fas fa-quote-left text-2xl mb-2"></i>
                                        <p className="text-xs">Start speaking to begin<br />the strategic review.</p>
                                    </div>
                                )}

                                {sessionstate.transcript.map((msg) => (
                                    <div key={msg.id} className={`flex flex-col gap-1.5 shrink-0 ${msg.speakerRole === 'STRATEGIST' ? 'items-end' : 'items-start'}`}>
                                        <div className="flex items-center gap-2 px-1">
                                            <span className={`text-[9px] font-black uppercase tracking-wider ${msg.speakerRole === 'STRATEGIST' ? 'text-indigo-400' : 'text-slate-400'}`}>
                                                {msg.speakerName}
                                            </span>
                                            <span className="text-[9px] text-slate-700 font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</span>
                                        </div>
                                        <div className={`
                                        max-w-[90%] p-3.5 rounded-2xl text-xs leading-relaxed border shadow-sm
                                        ${msg.speakerRole === 'STRATEGIST'
                                                ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none'
                                                : 'bg-slate-900 text-slate-300 border-slate-800 rounded-tl-none'}
                                    `}>
                                            {msg.content}

                                            {/* Expert Analysis Block (Co-Pilot Mode) */}
                                            {msg.expertAnalysis && (
                                                <div className="mt-3 p-2.5 bg-black/20 rounded-lg text-[10px] space-y-1.5 border-l-2 border-indigo-500/50">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <i className="fas fa-brain text-indigo-400"></i>
                                                        <span className="font-bold text-indigo-400 uppercase tracking-wider">Expert Analysis</span>
                                                    </div>
                                                    <div className="grid grid-cols-[60px_1fr] gap-1">
                                                        <span className="text-slate-500 font-bold">Problem:</span>
                                                        <span className="text-slate-300">{msg.expertAnalysis.problemIdentified}</span>
                                                    </div>
                                                    <div className="grid grid-cols-[60px_1fr] gap-1">
                                                        <span className="text-slate-500 font-bold">Root:</span>
                                                        <span className="text-slate-300">{msg.expertAnalysis.rootCause}</span>
                                                    </div>
                                                    <div className="grid grid-cols-[60px_1fr] gap-1">
                                                        <span className="text-slate-500 font-bold">Fix:</span>
                                                        <span className="text-indigo-300 font-medium">{msg.expertAnalysis.proposedSolution}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Artifact Renderer */}
                                            {msg.artifactType && msg.artifactType !== 'NONE' && (
                                                <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                                    <div className="flex items-center justify-between mb-1.5 px-1">
                                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                                            {msg.artifactType.replace(/_/g, ' ')}
                                                        </span>
                                                        <button className="text-[9px] text-indigo-400 hover:text-white transition-colors" title="Copy to Clipboard">
                                                            <i className="fas fa-copy"></i> Copy
                                                        </button>
                                                    </div>
                                                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[10px] overflow-x-auto shadow-inner text-emerald-400/80">
                                                        <pre>{msg.artifactContent}</pre>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {isThinking && (
                                    <div className="flex items-center gap-3 p-2 shrink-0">
                                        <div className="flex gap-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"></div>
                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce delay-75"></div>
                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce delay-150"></div>
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Agents deliberating...</span>
                                    </div>
                                )}
                                <div ref={transcriptEndRef} />
                            </div>

                            {/* Manual Input Area - Fixed at Bottom */}
                            <div className="p-4 border-t border-slate-800 bg-slate-900/50 shrink-0">
                                {/* Context Pills */}
                                {sessionstate.contextFiles && sessionstate.contextFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {sessionstate.contextFiles.map((f, i) => (
                                            <div key={i} className="flex items-center gap-2 bg-indigo-900/30 border border-indigo-500/30 rounded-lg px-2 py-1">
                                                <i className="fas fa-file text-[10px] text-indigo-400"></i>
                                                <span className="text-[10px] font-bold text-indigo-200 truncate max-w-[100px]">{f.name}</span>
                                                <button
                                                    onClick={() => setSessionState(prev => ({ ...prev, contextFiles: prev.contextFiles.filter((_, idx) => idx !== i) }))}
                                                    className="text-indigo-400 hover:text-white"
                                                >
                                                    <i className="fas fa-times text-[10px]"></i>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="relative flex items-center gap-2">
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        onChange={handleFileUpload}
                                        accept="image/*,application/pdf,text/plain"
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-10 h-10 shrink-0 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors flex items-center justify-center"
                                        title="Attach context file (Image, PDF)"
                                    >
                                        <i className="fas fa-paperclip"></i>
                                    </button>

                                    <input
                                        type="text"
                                        value={currentInput}
                                        onChange={(e) => setCurrentInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                        placeholder="Type your response..."
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-12 py-3 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all"
                                    />
                                    <button
                                        onClick={() => handleSendMessage()}
                                        disabled={!currentInput.trim() || isThinking}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <i className="fas fa-paper-plane text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <SessionSummaryModal
                isOpen={showSummary}
                onClose={() => setShowSummary(false)}
                summaryMarkdown={summaryContent}
                onApplyToBacklog={() => {
                    // Navigate back to Setup
                    setShowSummary(false);
                    setSessionState({
                        id: crypto.randomUUID(), // New Session ID
                        startTime: Date.now(),
                        isActive: false,
                        activeStage: currentStage,
                        participants: [],
                        transcript: [],
                        panelSentimentScore: 50,
                        contextFiles: []
                    });
                    setActiveAgents([]); // Clear active
                    setIsConfiguring(true); // Go to Setup
                }}
                onDiscard={() => {
                    // Navigate back to Setup
                    setShowSummary(false);
                    setSessionState({
                        id: crypto.randomUUID(), // New Session ID
                        startTime: Date.now(),
                        isActive: false,
                        activeStage: currentStage,
                        participants: [],
                        transcript: [],
                        panelSentimentScore: 50,
                        contextFiles: []
                    });
                    setActiveAgents([]); // Clear active
                    setIsConfiguring(true); // Go to Setup
                }}
            />
            {/* ADD AGENT MODAL */}
            {showAddAgentModal && (
                <div className="absolute inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
                    <div className="w-96 bg-slate-900 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                            <span className="text-xs font-bold text-white uppercase tracking-wider">Add Participant</span>
                            <button onClick={() => setShowAddAgentModal(false)} className="text-slate-400 hover:text-white">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-2 max-h-[300px] overflow-y-auto">
                            {(() => {
                                // Calculate Available Agents
                                const allDefaults = PersonaRegistry.getAllPersonas();
                                const customJson = localStorage.getItem('war_room_custom_agents');
                                const custom: PersonaAgent[] = customJson ? JSON.parse(customJson) : [];
                                const deletedDefaultsJson = localStorage.getItem('war_room_deleted_defaults');
                                const deletedDefaults = new Set(deletedDefaultsJson ? JSON.parse(deletedDefaultsJson) : []);

                                const allAvailable = [...allDefaults, ...custom].filter(a => !deletedDefaults.has(a.id));
                                const activeIds = new Set(activeAgents.map(a => a.id));
                                const candidates = allAvailable.filter(a => !activeIds.has(a.id));

                                if (candidates.length === 0) {
                                    return <div className="p-4 text-center text-slate-500 text-xs">No other agents available.</div>;
                                }

                                return candidates.map(agent => (
                                    <button
                                        key={agent.id}
                                        onClick={() => {
                                            // Add Agent Logic
                                            setActiveAgents(prev => [...prev, agent]);
                                            setSessionState(prev => ({
                                                ...prev,
                                                participants: [...prev.participants, agent.role],
                                                transcript: [
                                                    ...prev.transcript,
                                                    {
                                                        id: crypto.randomUUID(),
                                                        timestamp: Date.now(),
                                                        speakerName: 'SYSTEM',
                                                        speakerRole: 'STRATEGIST', // System message attributed to system/strategist
                                                        content: `[SYSTEM] ${agent.name} (${agent.role}) has joined the discussion.`,
                                                        sentiment: 'NEUTRAL'
                                                    }
                                                ]
                                            }));
                                            setShowAddAgentModal(false);
                                        }}
                                        className="w-full text-left p-3 rounded-lg hover:bg-slate-800 flex items-center gap-3 transition-colors group"
                                    >
                                        <div className="text-xl">{getAgentIcon(agent.role as PersonaRole)}</div>
                                        <div>
                                            <div className="text-xs font-bold text-slate-300 group-hover:text-white">{agent.name}</div>
                                            <div className="text-[9px] text-indigo-400 font-mono uppercase">{agent.role}</div>
                                        </div>
                                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                            <i className="fas fa-plus-circle text-indigo-500"></i>
                                        </div>
                                    </button>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
