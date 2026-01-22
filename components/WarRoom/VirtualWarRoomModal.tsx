import React, { useState, useEffect, useRef } from 'react';
import { DiscoveryStage, ProjectMetadata } from '../../types';
import { PersonaRole, SessionState, InteractionEvent, PersonaAgent, WarRoomContext } from '../../types/warRoom';
import { PersonaRegistry } from '../../services/warRoom/personaRegistry';
import { Moderator } from '../../services/warRoom/moderator';
import { SessionSummaryModal } from './SessionSummaryModal';
import { ElevenLabsService } from '../../services/elevenLabsService';

interface VirtualWarRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentStage: DiscoveryStage;
    projectContext: ProjectMetadata; // Legacy prop (keeping for compatibility but stageContext covers it)
    userName?: string;
    stageContext: WarRoomContext; // NEW: Detailed context
}

export const VirtualWarRoomModal: React.FC<VirtualWarRoomModalProps> = ({
    isOpen, onClose, currentStage, projectContext, userName = 'Strategist', stageContext
}) => {
    const [sessionstate, setSessionState] = useState<SessionState>({
        id: crypto.randomUUID(),
        startTime: Date.now(),
        isActive: false,
        activeStage: currentStage,
        participants: ['PRODUCT_MANAGER', 'ARCHITECT', 'TECH_LEAD', 'DELIVERY_MANAGER', 'LEAD_UX', 'END_USER', 'DEVELOPER'],
        transcript: [],
        panelSentimentScore: 50
    });

    const [isThinking, setIsThinking] = useState(false);
    const [currentInput, setCurrentInput] = useState('');
    const [permissionGranted, setPermissionGranted] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [isContextSynced, setIsContextSynced] = useState(true);

    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    // Auto-scroll
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [sessionstate.transcript]);

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
                effectiveContext
            );

            setSessionState(updatedState);

            const lastMessage = updatedState.transcript[updatedState.transcript.length - 1];
            if (lastMessage && lastMessage.speakerRole !== 'STRATEGIST') {
                const agent = PersonaRegistry.getPersona(lastMessage.speakerRole as PersonaRole);

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
    }, [sessionstate.isActive, isThinking]);

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
                                disabled={sessionstate.transcript.length === 0 || isSynthesizing}
                                className="h-8 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSynthesizing ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-flag-checkered"></i>}
                                {isSynthesizing ? 'Synthesizing...' : 'End & Synthesize'}
                            </button>
                            <button
                                onClick={() => {
                                    handleStopSession();
                                    onClose();
                                }}
                                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden relative">
                    {/* MAIN BOARDROOM VIEW (Agents) */}
                    <div className="flex-[3] relative bg-[url('https://res.cloudinary.com/dp653wzbb/image/upload/v1689230556/grid_bg_dark_zsd7i7.png')] bg-repeat bg-[length:50px_50px] flex flex-col">
                        <div className="absolute inset-0 bg-slate-950/80"></div>

                        {/* Agent Grid */}
                        <div className="relative z-10 flex-1 p-8 grid grid-cols-4 gap-6 content-center justify-items-center">
                            {PersonaRegistry.getAllPersonas().map((agent, idx) => {
                                const isSpeaking = sessionstate.currentTurn === agent.role;
                                const style = getAgentColor(agent.role);
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
                                            relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border p-5 flex flex-col items-center gap-3 transition-colors
                                            ${isSpeaking ? 'border-indigo-500/50 shadow-2xl shadow-indigo-500/20' : 'border-slate-800 hover:border-slate-700'}
                                        `}>
                                            <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center text-2xl relative ${style.split(' ')[1]}`}>
                                                <div className={`absolute inset-0 rounded-full border border-current opacity-20 ${isSpeaking ? 'animate-ping' : ''}`}></div>
                                                <span className="grayscale group-hover:grayscale-0 transition-all">
                                                    {getAgentIcon(agent.role)}
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
                                    relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border p-5 flex flex-col items-center gap-3 transition-colors
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
                            <div className="relative">
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

            <SessionSummaryModal
                isOpen={showSummary}
                onClose={() => setShowSummary(false)}
                summaryMarkdown={summaryContent}
                onApplyToBacklog={() => {
                    // Placeholder for future callback
                    setShowSummary(false);
                    setSessionState(prev => ({ ...prev, transcript: [], isActive: false, panelSentimentScore: 50 })); // Reset
                    onClose();
                }}
                onDiscard={() => {
                    setShowSummary(false);
                    setSessionState(prev => ({ ...prev, transcript: [], isActive: false, panelSentimentScore: 50 })); // Reset on discard too? User might want to keep history if they just closed summary. 
                    // Actually, let's keep it open if discarded, so they can continue debate.
                }}
            />
        </div>
    );
};
