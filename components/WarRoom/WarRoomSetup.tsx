import React, { useState, useEffect } from 'react';
import { PersonaAgent, SessionState } from '../../types/warRoom';
import { PersonaRegistry } from '../../services/warRoom/personaRegistry';
import ConfirmationModal from '../common/ConfirmationModal';

interface WarRoomSetupProps {
    onStartSession: (selectedAgents: PersonaAgent[]) => void;
    onResumeSession: (session: SessionState) => void; // New callback
    onCancel: () => void;
    projectId: string; // New prop for scoped persistence
}

export const WarRoomSetup: React.FC<WarRoomSetupProps> = ({ onStartSession, onResumeSession, onCancel, projectId }) => {
    const [availableAgents, setAvailableAgents] = useState<PersonaAgent[]>([]);
    const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
    const [tab, setTab] = useState<'SELECT' | 'CREATE' | 'HISTORY'>('SELECT'); // Added HISTORY tab

    // Creator State
    const [newAgent, setNewAgent] = useState<Partial<PersonaAgent>>({
        name: '',
        role: '',
        toneDescription: '',
        keywords: [],
        voiceId: ''
    });

    // History State
    const [history, setHistory] = useState<SessionState[]>([]);
    const [deletedDefaultIds, setDeletedDefaultIds] = useState<Set<string>>(new Set());
    const [confirmation, setConfirmation] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        isDestructive?: boolean;
        confirmLabel?: string;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
    });

    useEffect(() => {
        // Load Deleted Defaults
        const deletedJson = localStorage.getItem('war_room_deleted_defaults');
        const deletedSet = new Set<string>(deletedJson ? JSON.parse(deletedJson) : []);
        setDeletedDefaultIds(deletedSet);

        // Load Defaults (Filtering out deleted ones)
        const defaults = PersonaRegistry.getAllPersonas().filter(p => !deletedSet.has(p.id));

        // Load Custom from Firebase
        const loadData = async () => {
            try {
                // Determine if we ignore TypeScript error or cast
                // Ideally we import projectService but waiting for next chunk
                const { projectService } = await import('../../services/projectService');

                // MIGRATION CHECK: Check LocalStorage one last time
                const legacyCustomJson = localStorage.getItem('war_room_custom_agents');
                if (legacyCustomJson) {
                    const legacyAgents: PersonaAgent[] = JSON.parse(legacyCustomJson);
                    if (legacyAgents.length > 0) {
                        console.log("[Migration] Found legacy agents, uploading to Firebase...");
                        for (const agent of legacyAgents) {
                            await projectService.saveWarRoomAgent(projectId, agent);
                        }
                        // Clear after migration to avoid re-running
                        localStorage.removeItem('war_room_custom_agents');
                        console.log("[Migration] Legacy agents migrated and cleared.");
                    }
                }

                // Load Project Agents (which now includes migrated ones)
                const projectAgents = await projectService.getWarRoomAgents(projectId);

                setAvailableAgents([...defaults, ...projectAgents]);
            } catch (error) {
                console.error("Failed to load/migrate agents:", error);
                // Fallback to just defaults if fail
                setAvailableAgents(defaults);
            }
        };

        // const defaultIds = new Set(defaults.map(a => a.id));
        // setSelectedAgentIds(defaultIds);

        loadData();

        // Load History (Project Scoped) - MIGRATED TO FIREBASE
        const loadHistory = async () => {
            try {
                const { projectService } = await import('../../services/projectService');
                const sessions = await projectService.getWarRoomSessions(projectId);
                setHistory(sessions);
            } catch (error) {
                console.error("Failed to load war room history:", error);
            }
        };
        loadHistory();
    }, [projectId]);

    const toggleAgent = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation(); // Prevent trigger when clicking actions
        const newSet = new Set(selectedAgentIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            if (newSet.size >= 7) {
                setConfirmation({
                    isOpen: true,
                    title: "Maximum Limit Reached",
                    message: "You can only select up to 7 agents for a War Room session.",
                    onConfirm: () => { },
                    isDestructive: false,
                    confirmLabel: "Understood"
                });
                return;
            }
            newSet.add(id);
        }
        setSelectedAgentIds(newSet);
    };

    const handleCreateAgent = async () => {
        if (!newAgent.name || !newAgent.role || !newAgent.toneDescription) return;

        const customAgent: PersonaAgent = {
            id: newAgent.id || `custom-${crypto.randomUUID()}`, // Preserve ID if editing
            name: newAgent.name,
            role: newAgent.role.toUpperCase().replace(/\s+/g, '_'),
            toneDescription: newAgent.toneDescription,
            toolboxDescription: 'Custom defined capabilities',
            keywords: newAgent.keywords || [],
            voiceId: newAgent.voiceId || undefined,
            systemPrompt: `You are ${newAgent.name}, a ${newAgent.role}. ${newAgent.toneDescription}.`,
            isCustom: true
        };

        try {
            const { projectService } = await import('../../services/projectService');
            await projectService.saveWarRoomAgent(projectId, customAgent);

            // Refresh List
            const projectAgents = await projectService.getWarRoomAgents(projectId);
            const defaults = PersonaRegistry.getAllPersonas().filter(p => !deletedDefaultIds.has(p.id));
            setAvailableAgents([...defaults, ...projectAgents]);

            // Select it
            const newSet = new Set(selectedAgentIds);
            newSet.add(customAgent.id);
            setSelectedAgentIds(newSet);

            // Reset and Switch Tab
            setTab('SELECT');
            setNewAgent({ name: '', role: '', toneDescription: '', keywords: [], voiceId: '' });
        } catch (e) {
            console.error("Failed to save agent", e);
            alert("Failed to save agent. Please try again.");
        }
    };

    const handleEditAgent = (agent: PersonaAgent, e: React.MouseEvent) => {
        e.stopPropagation();
        setNewAgent({ ...agent }); // Populate form

        // If it was a default agent, we are essentially "Creating a copy" logic-wise, 
        // but user sees it as "Editing".
        // We will remove the ID so it generates a new custom ID, effectively treating it as a new custom override.
        // OR we can keep the ID if we want to "Shadow" it? 
        // Let's create a NEW custom one and "Delete" (hide) the default one to simulate replacement.
        if (!agent.isCustom) {
            // "Hide" original
            handleDeleteAgent(agent, e, true);
            // set newAgent without ID so it creates new custom
            setNewAgent({
                ...agent,
                id: undefined,
                toneDescription: agent.toneDescription || ''
            });
        }

        setTab('CREATE');
    };

    const handleDeleteAgent = (agent: PersonaAgent, e: React.MouseEvent, isSystemAction: boolean = false) => {
        e.stopPropagation();

        const proceedDelete = async () => {
            if (agent.isCustom) {
                // Permanently Delete Custom from Firebase
                try {
                    const { projectService } = await import('../../services/projectService');
                    await projectService.deleteWarRoomAgent(projectId, agent.id);

                    // Update State
                    setAvailableAgents(prev => prev.filter(a => a.id !== agent.id));
                } catch (err) {
                    console.error("Failed to delete agent", err);
                    alert("Failed to delete agent.");
                }
            } else {
                // "Delete" Default = Hide it (Local Storage pref is fine for this user-pref)
                const newDeleted = new Set(deletedDefaultIds);
                newDeleted.add(agent.id);
                setDeletedDefaultIds(newDeleted);
                localStorage.setItem('war_room_deleted_defaults', JSON.stringify(Array.from(newDeleted)));

                // Update State
                setAvailableAgents(prev => prev.filter(a => a.id !== agent.id));
            }

            // Deselect if active
            const newSet = new Set(selectedAgentIds);
            newSet.delete(agent.id);
            setSelectedAgentIds(newSet);
        };

        if (!isSystemAction) {
            setConfirmation({
                isOpen: true,
                title: `Delete ${agent.name}?`,
                message: "This action cannot be undone for custom agents. Default agents can be restored later.",
                onConfirm: proceedDelete,
                isDestructive: true,
                confirmLabel: "Delete"
            });
        } else {
            proceedDelete();
        }
    };

    const handleRestoreDefaults = () => {
        setConfirmation({
            isOpen: true,
            title: "Restore Default Agents?",
            message: "This will restore all default agents that were previously hidden.",
            isDestructive: true,
            confirmLabel: "Restore",
            onConfirm: async () => {
                localStorage.removeItem('war_room_deleted_defaults');
                setDeletedDefaultIds(new Set());

                // Reload all
                const defaults = PersonaRegistry.getAllPersonas();
                const { projectService } = await import('../../services/projectService');
                const projectAgents = await projectService.getWarRoomAgents(projectId);

                setAvailableAgents([...defaults, ...projectAgents]);
            }
        });
    };

    const handleDeleteHistory = (sessionId: string) => {
        setConfirmation({
            isOpen: true,
            title: "Delete Session History?",
            message: "This session transcript will be permanently removed.",
            isDestructive: true,
            confirmLabel: "Delete Forever",
            onConfirm: async () => {
                try {
                    const { projectService } = await import('../../services/projectService');
                    await projectService.deleteWarRoomSession(projectId, sessionId);
                    setHistory(prev => prev.filter(s => s.id !== sessionId));
                } catch (error) {
                    console.error("Failed to delete session:", error);
                    alert("Failed to delete session. Please try again.");
                }
            }
        });
    };

    return (
        <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col animate-in fade-in duration-300">
            {/* Header */}
            <div className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                        <i className="fas fa-users-cog text-white text-sm"></i>
                    </div>
                    <span className="font-bold text-white uppercase tracking-wider text-sm">War Room Setup</span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-500 font-mono">
                        {tab === 'SELECT' ? `${selectedAgentIds.size}/7 Agents Selected` : ''}
                    </span>
                    <button onClick={onCancel} className="text-slate-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar Tabs */}
                <div className="w-64 border-r border-slate-800 bg-slate-900 p-4 space-y-2">
                    <button
                        onClick={() => setTab('SELECT')}
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${tab === 'SELECT' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                    >
                        <i className="fas fa-list-ul mr-2"></i> Select Participants
                    </button>
                    <button
                        onClick={() => setTab('CREATE')}
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${tab === 'CREATE' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                    >
                        <i className="fas fa-plus mr-2"></i> Create Persona
                    </button>
                    <button
                        onClick={() => setTab('HISTORY')}
                        className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${tab === 'HISTORY' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                    >
                        <i className="fas fa-history mr-2"></i> Session History
                    </button>

                    {deletedDefaultIds.size > 0 && (
                        <button
                            onClick={handleRestoreDefaults}
                            className="w-full text-left px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all mt-8"
                        >
                            <i className="fas fa-undo mr-2"></i> Restore Defaults
                        </button>
                    )}
                </div>

                {/* Content Area */}
                <div className="flex-1 bg-slate-950 p-8 overflow-y-auto">
                    {tab === 'SELECT' && (
                        <div className="grid grid-cols-3 gap-4">
                            {availableAgents.map(agent => (
                                <div
                                    key={agent.id}
                                    onClick={() => toggleAgent(agent.id)}
                                    className={`
                                        relative group cursor-pointer p-3 rounded-lg border transition-all duration-200
                                        ${selectedAgentIds.has(agent.id)
                                            ? 'bg-indigo-900/20 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                                            : 'bg-slate-900 border-slate-800 hover:border-slate-700 opacity-60 hover:opacity-100'}
                                    `}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded-md bg-slate-800 flex items-center justify-center border border-slate-700 text-slate-400">
                                                {agent.isCustom ? (
                                                    <i className="fas fa-user-gear text-indigo-400 text-xs"></i>
                                                ) : (
                                                    <i className={`fas text-xs ${agent.role === 'PRODUCT_MANAGER' ? 'fa-user-tie text-emerald-400' :
                                                        agent.role === 'ARCHITECT' ? 'fa-sitemap text-indigo-400' :
                                                            agent.role === 'TECH_LEAD' ? 'fa-microchip text-blue-400' :
                                                                agent.role === 'LEAD_UX' ? 'fa-palette text-purple-400' :
                                                                    agent.role === 'DELIVERY_MANAGER' ? 'fa-clipboard-check text-amber-400' :
                                                                        agent.role === 'END_USER' ? 'fa-user-tag text-pink-400' :
                                                                            'fa-robot'
                                                        }`}></i>
                                                )}
                                            </div>
                                            {agent.isCustom && (
                                                <div className="px-1.5 py-0.5 rounded bg-slate-800 text-[8px] text-slate-400 font-bold border border-slate-700">CUSTOM</div>
                                            )}
                                        </div>
                                        {selectedAgentIds.has(agent.id) && (
                                            <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center shadow-md shadow-indigo-500/50">
                                                <i className="fas fa-check text-[8px] text-white"></i>
                                            </div>
                                        )}
                                    </div>
                                    <h3 className="text-white font-bold text-xs mb-0.5 mt-1">{agent.name}</h3>
                                    <div className="text-[9px] text-indigo-400 font-mono uppercase tracking-wider mb-1.5">{agent.role}</div>
                                    <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{agent.toneDescription}</p>

                                    {/* Edit/Delete Actions overlay on hover */}
                                    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => handleEditAgent(agent, e)}
                                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shadow-lg border border-slate-700"
                                            title="Edit Agent"
                                        >
                                            <i className="fas fa-pen text-[10px]"></i>
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteAgent(agent, e)}
                                            className="w-6 h-6 rounded bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors shadow-lg border border-slate-700"
                                            title="Delete Agent"
                                        >
                                            <i className="fas fa-trash text-[10px]"></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'CREATE' && (
                        <div className="max-w-xl mx-auto space-y-6">
                            <h2 className="text-xl font-bold text-white">Define New Agent</h2>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Agent Name</label>
                                    <input
                                        type="text"
                                        value={newAgent.name}
                                        onChange={e => setNewAgent({ ...newAgent, name: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-white text-sm focus:border-indigo-500 outline-none"
                                        placeholder="e.g. Sarah the Skeptic"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Role Title</label>
                                    <input
                                        type="text"
                                        value={newAgent.role}
                                        onChange={e => setNewAgent({ ...newAgent, role: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-white text-sm focus:border-indigo-500 outline-none"
                                        placeholder="e.g. Compliance Officer"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Tone & Personality</label>
                                    <textarea
                                        value={newAgent.toneDescription}
                                        onChange={e => setNewAgent({ ...newAgent, toneDescription: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-white text-sm focus:border-indigo-500 outline-none h-24 resize-none"
                                        placeholder="Describe how they behave. e.g. 'Highly critical, focuses on legal risks, asks tough questions.'"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Voice ID (Optional)</label>
                                    <input
                                        type="text"
                                        value={newAgent.voiceId}
                                        onChange={e => setNewAgent({ ...newAgent, voiceId: e.target.value })}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-white text-sm focus:border-indigo-500 outline-none"
                                        placeholder="ElevenLabs Voice ID"
                                    />
                                </div>

                                <button
                                    onClick={handleCreateAgent}
                                    disabled={!newAgent.name || !newAgent.role || !newAgent.toneDescription}
                                    className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-md shadow-indigo-500/20"
                                >
                                    Save Agent to Library
                                </button>
                            </div>
                        </div>
                    )}

                    {tab === 'HISTORY' && (
                        <div className="space-y-4">
                            {history.length === 0 ? (
                                <div className="text-center text-slate-500 py-20">
                                    <i className="fas fa-history text-4xl mb-4 opacity-50"></i>
                                    <p className="text-sm">No session history found for this project.</p>
                                </div>
                            ) : (
                                history.map(session => (
                                    <div key={session.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex items-center justify-between hover:border-slate-700 transition-colors">
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className="text-sm font-bold text-white uppercase tracking-wider">
                                                    {new Date(session.startTime).toLocaleDateString()}
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {new Date(session.startTime).toLocaleTimeString()}
                                                </span>
                                                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase border border-indigo-500/30">
                                                    {session.activeStage}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-400">
                                                {session.transcript.length} interactions • Sentiment: {session.panelSentimentScore}%
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => onResumeSession(session)}
                                                className="px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 text-xs font-bold uppercase tracking-wider transition-colors"
                                            >
                                                <i className="fas fa-play mr-2"></i> Resume
                                            </button>
                                            <button
                                                onClick={() => handleDeleteHistory(session.id)}
                                                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-colors flex items-center justify-center"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>


            {/* Footer Action */}
            <div className="h-20 border-t border-slate-800 bg-slate-900/50 flex items-center justify-end px-8">
                <button
                    onClick={() => {
                        const selected = availableAgents.filter(a => selectedAgentIds.has(a.id));
                        onStartSession(selected);
                    }}
                    disabled={selectedAgentIds.size === 0}
                    className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    Enter War Room <i className="fas fa-arrow-right ml-2"></i>
                </button>
            </div>

            <ConfirmationModal
                isOpen={confirmation.isOpen}
                onClose={() => setConfirmation(prev => ({ ...prev, isOpen: false }))}
                onConfirm={() => {
                    confirmation.onConfirm();
                    setConfirmation(prev => ({ ...prev, isOpen: false }));
                }}
                title={confirmation.title}
                message={confirmation.message}
                confirmLabel={confirmation.confirmLabel}
                isDestructive={confirmation.isDestructive}
                cancelLabel={confirmation.isDestructive ? "Cancel" : undefined} // Hide cancel for Info alerts (non-destructive)
            />
        </div >
    );
};
