
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { InstructionEditModal } from './components/InstructionEditModal';
import { DiscoveryStage, AppState, FileContext, VoiceState, Project, ProjectMetadata, StageVersion, GroundingSource } from './types';
import { STAGE_CONFIGS } from './constants';
import { callGeminiAgent } from './services/geminiService';
import { projectService } from './services/projectService';
import { createDefaultProjectState } from './services/projectService';
import { GeminiCapability } from './services/modelConfig';
import { scrapeUrl } from './services/webScraper';
import { jiraService } from './services/jiraService';
import { createLiveAssistant } from './services/liveService';
import { HybridVoiceAssistant } from './services/groqVoiceService';
import { VoiceInputTrigger } from './components/VoiceInputTrigger';
import { RefineInputButton } from './components/RefineInputButton';
import { JIRA_TOOLS, jiraAgent } from './services/jiraAgent';
import MarkdownRenderer from './components/MarkdownRenderer';
import PresentationView from './components/PresentationView';
import ChatBot from './components/ChatBot';
import ProductManual from './components/ProductManual';
import ProjectListModal from './components/ProjectListModal';
import { marked } from 'marked';
import { useAuth } from './src/contexts/AuthContext';
import { useRBAC } from './src/hooks/useRBAC';
import AdminUserModal from './components/AdminUserModal';
import { ShareProjectModal } from './components/ShareProjectModal';
import ConfirmationModal from './components/common/ConfirmationModal';
import Toast, { ToastType } from './components/common/Toast';
import { EstimationSheet } from './components/EstimationSheet';

const INITIAL_METADATA: ProjectMetadata = {
  companyName: '',
  missionStatement: '',
  targetVertical: '',
  geography: '',
  tam: '',
  revenueModel: '',
  websiteUrls: '',
  keyCompetitors: '',
};

const INITIAL_STATE: AppState = {
  currentStage: DiscoveryStage.DOMAIN,
  projectMetadata: INITIAL_METADATA,
  settings: {
    isThinkingEnabled: false,
    thinkingTemperature: 0.7,
    thinkingTopP: 0.95,
    isSearchEnabled: false,
  },
  stages: {
    [DiscoveryStage.DOMAIN]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.BOD]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.KPI]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.EPICS]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
  }
};

const ModelSelector: React.FC<{ value: string; onChange: (val: string) => void; className?: string }> = ({ value, onChange, className }) => (
  <div className={`relative group ${className || ''}`}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none bg-slate-900 border border-slate-700 text-slate-300 text-[11px] font-bold rounded-lg pl-3 pr-8 py-1.5 focus:ring-blue-500 focus:border-blue-500 hover:border-slate-500 transition-colors cursor-pointer outline-none uppercase tracking-wider w-full"
      title="Select AI Model"
    >
      <optgroup label="Gemini (Google)">
        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
        <option value="gemini-3-flash-preview">Gemini 3 Preview</option>
      </optgroup>
      <optgroup label="Groq (Failover)">
        <option value="groq-llama-3">Groq (Llama 3)</option>
      </optgroup>
    </select>
    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
      <i className="fas fa-chevron-down text-xs"></i>
    </div>
  </div>
);

const App: React.FC = () => {
  const { logout, user } = useAuth();
  const { role, canUseAdvancedAI, canExportData, canUseRefinementStudio, canEditProject, isAdmin, canShareProject, canSyncJira, canUseEstimationStudio, canManageStageIterations, canCustomizeInstructions } = useRBAC();

  // DEBUG: Permission Tracing
  useEffect(() => {
    console.log("[RBAC DEBUG] Current Role:", role);
    console.log("[RBAC DEBUG] Can Customize Instructions:", canCustomizeInstructions);
    console.log("[RBAC DEBUG] Can Use Refinement:", canUseRefinementStudio);
  }, [role, canCustomizeInstructions, canUseRefinementStudio]);

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [analyzingStage, setAnalyzingStage] = useState<DiscoveryStage | null>(null);
  const [statusIdx, setStatusIdx] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro'); // Default to Stable Pro
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [showProjectConfig, setShowProjectConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [urlInput, setUrlInput] = useState('');


  // New UI States
  const [toast, setToast] = useState<{ message: string, type: ToastType } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    type: 'RESET' | 'RESTORE' | 'DISCARD_REFINEMENT' | 'DISCARD_EDIT' | 'CANCEL_EDIT' | 'JIRA_SYNC_SUCCESS';
    payload?: any;
    title: string;
    message: string;
    confirmLabel: string;
    isDestructive?: boolean;
  } | null>(null);

  // Audio Context for Visualization
  const audioContextRef = useRef<AudioContext | null>(null);

  // Project Management State
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjectList, setShowProjectList] = useState(false);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<Record<string, string>>({});

  // Initialize Project System
  useEffect(() => {
    const initProject = async () => {
      if (user && !activeProjectId) {
        try {
          const projects = await projectService.getUserProjects(user.uid);
          if (projects.length > 0) {
            // Load most recent
            loadProject(projects[0]);
          } else {
            // Create default
            const newProject = await projectService.createProject(user.uid, user.displayName || user.email || 'Anonymous');
            loadProject(newProject);
          }
        } catch (e) {
          console.error("Project init error", e);
        }
      }
    };
    initProject();
  }, [user]);

  const loadProject = (project: Project) => {
    setActiveProjectId(project.id);

    // Construct AppState from Project
    setState({
      currentStage: project.currentStage,
      projectMetadata: project.projectMetadata,
      stages: project.stages,
      settings: project.settings || { isThinkingEnabled: false, isSearchEnabled: false },
      // IMPORTANT: State doesn't usually hold the project object directly, but we might want to extend it
      // For now, we rely on activeProjectId to update 'currentProject' concept or update the state if we added fields.
      // Wait, 'state' handles stages/metadata. Where is customInstructions stored in state?
      // AppState needs to support it or we store it in a separate state or attach to 'currentProject' state if it exists.
      // Looking at `state` definition lines 41-56, it does NOT have customInstructions. 
      // I should add it to AppState or just keep it in sync with `activeProjectId`.
      // Let's modify loadProject to set a local ref or state. 
    });

    // Set custom instructions into state (See next Edit to AppState definition)
    if (project.customInstructions) {
      setCustomInstructions(project.customInstructions);
    } else {
      setCustomInstructions({});
    }

    setShowProjectList(false);
  };

  const handleSaveInstruction = async (instruction: string | undefined) => {
    if (!activeProjectId) return;

    try {
      const newInstructions = { ...customInstructions };
      if (instruction === undefined) {
        delete newInstructions[state.currentStage];
      } else {
        newInstructions[state.currentStage] = instruction;
      }

      setCustomInstructions(newInstructions);

      // Persist to Firestore
      await projectService.updateProject(activeProjectId, {
        customInstructions: newInstructions
      });

      setToast({ message: "System instructions updated.", type: 'success' });
    } catch (e) {
      console.error("Failed to save instructions", e);
      setToast({ message: "Failed to save instructions.", type: 'error' });
    }
  };

  const handleProjectUpdated = (updatedProject: Project) => {
    if (updatedProject.id === activeProjectId) {
      setState(prev => ({
        ...prev,
        projectMetadata: {
          ...prev.projectMetadata,
          companyName: updatedProject.projectMetadata.companyName
        }
      }));
    }
  };

  // Auto-Save Project State
  useEffect(() => {
    if (!user || !activeProjectId) return;

    const saveTimer = setTimeout(() => {
      const projectToSave: Project = {
        ...state,
        id: activeProjectId,
        userId: user.uid,
        name: state.projectMetadata.companyName || 'Untitled Project',
        // createdAt/updatedAt handled by service or kept from previous if we merged properly. 
        // Service handles updatedAt. CreatedAt we ideally should persist. 
        // For simplicity, service merge will keep existing fields.
        createdAt: 0, // Dummies, service handles merge
        updatedAt: 0
      };
      projectService.saveProject(projectToSave).catch(e => console.error("Auto-save failed", e));
    }, 2000); // 2 second debounce

    return () => clearTimeout(saveTimer);
  }, [state, activeProjectId, user]);

  // Jira State
  const [showJiraSync, setShowJiraSync] = useState(false);
  const [showEstimationStudio, setShowEstimationStudio] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isJiraSyncing, setIsJiraSyncing] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState('');
  const [jiraConfig, setJiraConfig] = useState({
    domain: (process.env as any).VITE_JIRA_DOMAIN || '',
    email: (process.env as any).VITE_JIRA_EMAIL || '',
    apiToken: (process.env as any).VITE_JIRA_API_TOKEN || '',
    projectKey: (process.env as any).VITE_JIRA_PROJECT_KEY || ''
  });

  // Output Editing & Refinement
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [tempOutput, setTempOutput] = useState('');

  // Immersive Refinement Modal State
  const [showRefinementModal, setShowRefinementModal] = useState(false);
  const [isRefinementJiraMode, setIsRefinementJiraMode] = useState(false);
  const [pendingRefinementToolCall, setPendingRefinementToolCall] = useState<any>(null); // For deletion confirmation
  const [previewOutput, setPreviewOutput] = useState(''); // Holds the provisional content in modal
  const [refinementChatHistory, setRefinementChatHistory] = useState<Array<{ role: 'user' | 'ai', text: string }>>([]);
  const [refinementInput, setRefinementInput] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Generate a consistent random ID for this session
  const sessionId = useMemo(() => Math.floor(100 + Math.random() * 900), []);

  // Refs
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const liveSessionRef = useRef<any>(null);
  const prevAnalyzingStageRef = useRef<DiscoveryStage | null>(null);

  // Voice State
  const [voice, setVoice] = useState<VoiceState>({ isActive: false, isListening: false, isSpeaking: false, transcript: '' });

  const config = STAGE_CONFIGS[state.currentStage];
  const currentStageData = state.stages[state.currentStage];

  const isMetadataComplete = useMemo(() => {
    const m = state.projectMetadata;
    return !!(m.companyName && m.targetVertical && m.geography && m.tam && m.revenueModel && m.websiteUrls && m.keyCompetitors);
  }, [state.projectMetadata]);

  // Metadata enforcement removed


  useEffect(() => {
    if (prevAnalyzingStageRef.current !== null && analyzingStage === null) {
      const timer = setTimeout(() => {
        if (mainScrollRef.current) {
          mainScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
          mainScrollRef.current.scrollTop = 0;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
    prevAnalyzingStageRef.current = analyzingStage;
  }, [analyzingStage]);

  useEffect(() => {
    let interval: any;
    if (analyzingStage) {
      const messages = STAGE_CONFIGS[analyzingStage]?.statusMessages || config.statusMessages;
      interval = setInterval(() => {
        setStatusIdx((prev) => (prev + 1) % messages.length);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [analyzingStage, config.statusMessages]);

  const calculateCoherenceScore = () => {
    let score = 40; // Base "Agent Ready" score

    // Metadata Quality (Max +30)
    if (isMetadataComplete) score += 30;
    else {
      const fields = Object.values(state.projectMetadata).filter(v => !!v).length;
      score += (fields / 8) * 30;
    }

    // Input Depth (Max +15)
    const inputLen = state.stages[state.currentStage].input.length;
    score += Math.min(15, (inputLen / 500) * 15);

    // Intelligence Multipliers (Max +15)
    if (state.settings.isThinkingEnabled) score += 7.5;
    if (state.settings.isSearchEnabled) score += 7.5;

    // Consistency check
    const previousStages = (Object.values(DiscoveryStage) as DiscoveryStage[])
      .slice(0, (Object.values(DiscoveryStage) as DiscoveryStage[]).indexOf(state.currentStage));
    const completedPrevious = previousStages.filter(s => state.stages[s].status === 'completed').length;
    if (previousStages.length > 0) {
      score += (completedPrevious / previousStages.length) * 10;
    } else {
      score += 10; // First stage bonus
    }

    return Math.min(99, Math.round(score)); // Cap at 99% for professional realism
  };


  const startGroqVoice = () => {
    console.log("Starting Hybrid Voice Assistant (Gemini Primary -> Groq Fallback)...");
    liveSessionRef.current = new HybridVoiceAssistant({
      onUpdateMainContext: (text, mode) => {
        setState(prev => ({
          ...prev,
          stages: {
            ...prev.stages,
            [prev.currentStage]: {
              ...prev.stages[prev.currentStage],
              input: mode === 'replace' ? text : `${prev.stages[prev.currentStage].input}\n${text}`
            }
          }
        }));
      },
      onUpdateRefinementAnswer: (index, text) => {
        setState(prev => ({
          ...prev,
          stages: {
            ...prev.stages,
            [prev.currentStage]: {
              ...prev.stages[prev.currentStage],
              answers: { ...prev.stages[prev.currentStage].answers, [index.toString()]: text }
            }
          }
        }));
      },
      onSwitchModule: (module) => {
        setState(prev => ({ ...prev, currentStage: module as DiscoveryStage }));
      },
      onTranscription: (text, role) => {
        setVoice(v => ({ ...v, transcript: text }));
      },
      onStateChange: (s) => setVoice(v => ({ ...v, ...s }))
    }, state);
    liveSessionRef.current.start();
  };

  const toggleVoice = () => {
    if (voice.isActive) {
      if (liveSessionRef.current && liveSessionRef.current.stop) {
        liveSessionRef.current.stop();
      }
      setVoice({ isActive: false, isListening: false, isSpeaking: false, transcript: '' });
      liveSessionRef.current = null;
    } else {
      setVoice(v => ({ ...v, isActive: true, isListening: true }));

      // Try Gemini Live First
      try {
        console.log("Attempting to connect to Gemini Live...");
        const currentQuestions = state.stages[state.currentStage].questions;
        const currentInput = state.stages[state.currentStage].input;

        liveSessionRef.current = createLiveAssistant({
          onUpdateMainContext: (text, mode) => {
            setState(prev => ({
              ...prev,
              stages: {
                ...prev.stages,
                [prev.currentStage]: {
                  ...prev.stages[prev.currentStage],
                  input: mode === 'replace' ? text : `${prev.stages[prev.currentStage].input}\n${text}`
                }
              }
            }));
          },
          onUpdateRefinementAnswer: (index, text) => {
            setState(prev => ({
              ...prev,
              stages: {
                ...prev.stages,
                [prev.currentStage]: {
                  ...prev.stages[prev.currentStage],
                  answers: { ...prev.stages[prev.currentStage].answers, [index.toString()]: text }
                }
              }
            }));
          },
          onSwitchModule: (module) => {
            setState(prev => ({ ...prev, currentStage: module as DiscoveryStage }));
          },
          onTranscription: (text, role) => {
            setVoice(v => ({ ...v, transcript: text }));
          },
          onStateChange: (s) => setVoice(v => ({ ...v, ...s })),
          onError: (err) => {
            console.warn("Gemini Live Error. Switching to Groq Fallback.", err);
            if (liveSessionRef.current === null) return; // Already stopped
            startGroqVoice();
          }
        }, currentQuestions, currentInput);

      } catch (err) {
        console.error("Gemini Live Initialization Failed:", err);
        startGroqVoice();
      }
    }
  };

  // Separate handler for Field-Level Voice Triggers (Microphone Buttons)
  // This uses the Hybrid (Gemini -> Groq) non-streaming assistant for specific updates
  const handleFieldVoice = (customContext?: string) => {
    if (liveSessionRef.current) {
      // If already running (Stop it)
      if (liveSessionRef.current.stop) liveSessionRef.current.stop();
      liveSessionRef.current = null;
      setVoice(prev => ({ ...prev, isActive: false, isListening: false }));
      return;
    }

    // Start Hybrid Assistant
    setVoice(prev => ({ ...prev, isActive: true, isListening: true }));
    liveSessionRef.current = new HybridVoiceAssistant({
      onUpdateMainContext: (text, mode) => {
        setState(prev => ({
          ...prev,
          stages: {
            ...prev.stages,
            [prev.currentStage]: {
              ...prev.stages[prev.currentStage],
              input: mode === 'replace' ? text : `${prev.stages[prev.currentStage].input}\n${text}`
            }
          }
        }));
      },
      onUpdateRefinementAnswer: (index, text) => {
        setState(prev => ({
          ...prev,
          stages: {
            ...prev.stages,
            [prev.currentStage]: {
              ...prev.stages[prev.currentStage],
              answers: { ...prev.stages[prev.currentStage].answers, [index.toString()]: text }
            }
          }
        }));
      },
      onSwitchModule: (module) => {
        setState(prev => ({ ...prev, currentStage: module as DiscoveryStage }));
      },
      onTranscription: (text, role) => {
        setVoice(v => ({ ...v, transcript: text }));
      },
      onStateChange: (s) => setVoice(v => ({ ...v, ...s }))
    }, state, customContext);

    // Start listening
    (liveSessionRef.current as any).start();
  };

  const parseQuestions = (text: string) => {
    const lines = text.split('\n');
    const questions: string[] = [];
    let capture = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toUpperCase().includes('CLARIFICATION QUESTIONS')) {
        capture = true;
        continue;
      }
      if (capture && /^[\*]*\d+[\.\)][\s\*]*/.test(trimmed)) {
        const cleaned = trimmed
          .replace(/^[\*]*\d+[\.\)][\s\*]*/, '')
          .replace(/[\*]+$/, '')
          .trim();
        if (cleaned.length > 0) questions.push(cleaned);
      }
    }
    return questions;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: { ...prev.stages[prev.currentStage], input: value }
      }
    }));
  };

  const handleMetadataChange = (field: keyof ProjectMetadata, value: string) => {
    setState(prev => ({
      ...prev,
      projectMetadata: { ...prev.projectMetadata, [field]: value }
    }));
  };

  const handleUrlAdd = () => {
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.startsWith('http')) url = 'https://' + url;

    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          urls: [...(prev.stages[prev.currentStage].urls || []), url]
        }
      }
    }));
    setUrlInput('');
  };

  const handleUrlRemove = (url: string) => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          urls: (prev.stages[prev.currentStage].urls || []).filter(u => u !== url)
        }
      }
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isReference: boolean = false) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (isReference) {
      const file = files[0];
      const isMultimodal =
        file.type.startsWith('image/') ||
        file.type.startsWith('video/') ||
        file.type === 'application/pdf';

      const content = isMultimodal
        ? await new Promise<string>((res) => {
          const reader = new FileReader();
          reader.onload = (ev) => res(ev.target?.result?.toString().split(',')[1] || '');
          reader.readAsDataURL(file);
        })
        : await file.text();

      setState(prev => ({
        ...prev,
        stages: {
          ...prev.stages,
          [prev.currentStage]: {
            ...prev.stages[prev.currentStage],
            formatReference: { name: file.name, content, mimeType: file.type, size: file.size }
          }
        }
      }));
      e.target.value = '';
      return;
    }

    const newFiles: FileContext[] = [];
    for (const file of Array.from(files) as File[]) {
      const isMultimodal =
        file.type.startsWith('image/') ||
        file.type.startsWith('video/') ||
        file.type === 'application/pdf';

      let content = '';
      if (isMultimodal) {
        content = await new Promise<string>((res) => {
          const reader = new FileReader();
          reader.onload = (ev) => res(ev.target?.result?.toString().split(',')[1] || '');
          reader.readAsDataURL(file);
        });
      } else {
        content = await file.text();
      }
      newFiles.push({ name: file.name, content, mimeType: file.type, size: file.size });
    }

    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          files: [...prev.stages[prev.currentStage].files, ...newFiles]
        }
      }
    }));
    e.target.value = '';
  };

  const removeFile = (fileName: string) => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          files: prev.stages[prev.currentStage].files.filter(f => f.name !== fileName)
        }
      }
    }));
  };

  const removeFormatReference = () => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          formatReference: undefined
        }
      }
    }));
  };

  const handleAnswerChange = (qIdx: number, val: string) => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          answers: { ...prev.stages[prev.currentStage].answers, [qIdx.toString()]: val }
        }
      }
    }));
  };

  const importPrevious = () => {
    const stages = Object.values(DiscoveryStage) as DiscoveryStage[];
    const currIdx = stages.indexOf(state.currentStage);

    if (currIdx === 0) {
      alert("No history to import: You are currently in the initial module.");
      return;
    }

    const previousStages = stages.slice(0, currIdx);
    const availableHistory = previousStages.filter(s => state.stages[s].output);

    if (availableHistory.length === 0) {
      alert("History unavailable: Please complete a previous module first.");
      return;
    }

    const fullHistory = availableHistory
      .map(s => {
        const stageData = state.stages[s];
        const answeredQuestionsContext = stageData.questions
          .map((q, idx) => ({ q, a: stageData.answers[idx.toString()] as string | undefined }))
          .filter(item => item.a && item.a.trim().length > 0)
          .map(item => `USER RESPONSE: ${item.q} -> ${item.a}`)
          .join('\n');

        return `--- ${s} ANALYSIS ---\n${stageData.output}${answeredQuestionsContext ? `\n\n--- ${s} REFINEMENTS ---\n${answeredQuestionsContext}` : ''}`;
      })
      .join('\n\n');

    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [prev.currentStage]: {
          ...prev.stages[prev.currentStage],
          input: `${fullHistory}\n\n--- NEW INPUT ---\n${prev.stages[prev.currentStage].input}`
        }
      }
    }));
  };

  const runAnalysis = async () => {
    // Optional metadata check
    if (!isMetadataComplete && !state.projectMetadata.companyName) {
      console.log("Proceeding with partial/empty metadata");
    }

    const targetStage = state.currentStage;
    setAnalyzingStage(targetStage);
    setStatusIdx(0);

    try {
      const prevContext = (Object.values(DiscoveryStage) as DiscoveryStage[])
        .slice(0, Object.values(DiscoveryStage).indexOf(targetStage))
        .map(s => `[${s} ANALYSIS]:\n${state.stages[s].output}`)
        .join('\n\n');

      const stageData = state.stages[targetStage];
      const filteredAnswers = (Object.entries(stageData.answers) as [string, string][])
        .filter(([idx, val]) => val && val.trim().length > 0)
        .reduce((acc, [idx, val]) => ({ ...acc, [stageData.questions[parseInt(idx)]]: val }), {});

      const metadataContext = `
GLOBAL PROJECT CONTEXT:
- Company Name: ${state.projectMetadata.companyName || 'Not Provided'}
- Mission: ${state.projectMetadata.missionStatement || 'Not Provided'}
- Target Vertical: ${state.projectMetadata.targetVertical || 'Not Provided'}
- Geography: ${state.projectMetadata.geography || 'Not Provided'}
- TAM: ${state.projectMetadata.tam || 'Not Provided'}
- Revenue Model: ${state.projectMetadata.revenueModel || 'Not Provided'}
- Global Websites: ${state.projectMetadata.websiteUrls || 'Not Provided'}
- Competitors: ${state.projectMetadata.keyCompetitors || 'Not Provided'}
      `;

      let userPrompt = `
${metadataContext}

=== ACTIVE TASK INPUT (FOCUS HERE) ===
"${stageData.input}"
======================================

=== MODULE CONTEXT (USE FOR SEARCH RELEVANCE) ===
Stage: ${STAGE_CONFIGS[targetStage].title}
Company: ${state.projectMetadata.companyName || 'Generic Product'}
Vertical: ${state.projectMetadata.targetVertical || 'General'}
=================================================

=== BACKGROUND HISTORY (READ-ONLY CONTEXT) ===
NOTE: The following history is for context only. DO NOT perform searches based on errors, logs, or issues found in this history unless explicitly requested in the Active Task Input.
${prevContext}
==============================================

USER RESPONSES TO CLARIFICATIONS: ${JSON.stringify(filteredAnswers)}

STAGE-SPECIFIC REFERENCE URLS:
${(stageData.urls || []).join('\n')}

CRITICAL INSTRUCTIONS:
1. Analyze the "ACTIVE TASK INPUT" deeply. This is your primary directive.
2. Use "BACKGROUND HISTORY" only to maintain consistency (names, goals). Ignore technical errors in history.
3. If visual assets or URLs are provided, analyze them for UI/UX and feature details.

SEARCH GUIDANCE (STRICT):
When using Google Search:
- Generate queries based ONLY on "ACTIVE TASK INPUT" and "GLOBAL PROJECT CONTEXT".
- ABSOLUTELY DO NOT search for "MSBuild", "error codes", "compilation failures", or "system logs" found in history.
- Search for: "Market size of...", "Competitors to...", "Technical architecture for...", "API documentation for...".
      `;

      if (stageData.formatReference) {
        userPrompt += `\n\nSTRICT FORMATTING: Follow the structure of [REF: ${stageData.formatReference.name}] exactly. Match its tables and section hierarchy.`;
      }

      const allFiles = [...stageData.files];
      if (stageData.formatReference) allFiles.push(stageData.formatReference);

      // SCRAPING LOGIC
      let finalUserPrompt = userPrompt;
      if (stageData.urls && stageData.urls.length > 0) {
        console.log("Scraping URLs...", stageData.urls);
        const scrapePromises = stageData.urls.map(url => scrapeUrl(url));
        const scrapedResults = await Promise.all(scrapePromises);
        finalUserPrompt += `\n\n=== SCRAPED WEB CONTENT ===\n${scrapedResults.join('\n\n----------------\n\n')}\n===========================`;
      }

      let result;

      // Resolve AI Settings with defaults
      const effectiveTemp = state.settings.thinkingTemperature ?? 0.7;
      const effectiveTopP = state.settings.thinkingTopP ?? 0.95;

      console.log("[App.tsx] runAnalysis resolved settings:", {
        isThinking: state.settings.isThinkingEnabled,
        temp: effectiveTemp,
        topP: effectiveTopP
      });

      // DISPATCHER LOGIC: Select Service based on Dropdown
      if (selectedModel.startsWith('groq-')) {
        console.log(`[Dispatcher] Routing to Groq Service (${selectedModel})...`);

        // Import dynamically if needed, or rely on top-level. Using top-level import from plan.
        // We must adapt the response format or ensure GroqVoiceService isn't confusingly named (it's groqService.ts).
        const { callGroqAgent } = await import('./services/groqService'); // Dynamic import to be safe/lazy

        // Call Groq
        // Model mapping: groq-llama-3 -> openai/gpt-oss-120b (as per service logic) or pass explicit?
        // The service currently hardcodes selection based on multimodal. 
        // We will pass the ID just for logging, but the service handles the specific Llama implementation.
        const groqResponse = await callGroqAgent(
          selectedModel, // Passed for logging, service decides actual endpoint
          customInstructions[targetStage] || STAGE_CONFIGS[targetStage].systemInstruction,
          finalUserPrompt,
          allFiles,
          state.settings.isThinkingEnabled,
          state.settings.isSearchEnabled,
          effectiveTemp, // Pass configured temperature
          effectiveTopP // Pass configured TopP
        );

        // Normalize response
        result = {
          text: groqResponse.text,
          sources: groqResponse.sources || [],
          searchEntryPointHtml: groqResponse.searchEntryPointHtml
        };

      } else {
        console.log(`[Dispatcher] Routing to Gemini Service (${selectedModel})...`);
        result = await callGeminiAgent(
          GeminiCapability.ANALYSIS_MAIN,
          customInstructions[targetStage] || STAGE_CONFIGS[targetStage].systemInstruction,
          finalUserPrompt,
          allFiles,
          state.settings.isThinkingEnabled,
          state.settings.isSearchEnabled,
          selectedModel, // Pass the specific override
          undefined,    // tools
          effectiveTemp, // Pass configured temperature
          effectiveTopP // Pass configured TopP
        );
      }

      const finalCoherence = calculateCoherenceScore();

      // Update State Directly (User is blocked by full-screen loader, so race conditions are minimal)
      const questions = parseQuestions(result.text);

      setState(prev => {
        // Double check we haven't somehow switched stages (unlikely with modal blocker)
        if (prev.currentStage !== targetStage) return prev;

        const oldData = prev.stages[targetStage];
        const newVersion: StageVersion = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          output: result.text,
          input: oldData.input,
          questions: questions,
          coherenceScore: finalCoherence,
          searchEntryPointHtml: result.searchEntryPointHtml
        };

        return {
          ...prev,
          stages: {
            ...prev.stages,
            [targetStage]: {
              ...oldData,
              output: result.text,
              status: 'completed',
              questions,
              groundingSources: result.sources,
              searchEntryPointHtml: result.searchEntryPointHtml,
              coherenceScore: finalCoherence,
              versions: [newVersion, ...(oldData.versions || [])].slice(0, 10) // Keep last 10
            }
          }
        };
      });

    } catch (err) {
      console.error(err);
      alert("Analysis encountered a snag. Retrying often helps.");
    } finally {
      setAnalyzingStage(null);
    }
  };

  // --- Refinement Modal Logic ---

  const openRefinementModal = () => {
    if (!currentStageData.output) return;
    setPreviewOutput(currentStageData.output);
    setRefinementChatHistory([{ role: 'ai', text: 'I am ready to help you refine this document. What would you like to change?' }]);
    setRefinementInput('');
    setShowRefinementModal(true);
  };

  const handleManualEditCancel = () => {
    setConfirmation({
      type: 'CANCEL_EDIT',
      title: "Discard Edits",
      message: "Are you sure you want to discard your manual edits?",
      confirmLabel: "Discard",
      isDestructive: true
    });
  };

  const applyRefinement = () => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [state.currentStage]: {
          ...prev.stages[state.currentStage],
          output: previewOutput
        }
      }
    }));
    setShowRefinementModal(false);
  };

  const handleRefineChat = async () => {
    if (!refinementInput.trim() || !previewOutput) return;

    const userMessage = refinementInput.trim();
    setRefinementChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);
    setRefinementInput('');
    setIsRefining(true);

    try {
      let refineSystemInstruction = `You are an expert editor collaborating with a user on a document. 
      Your task is to MODIFY the document content based on the user's latest instruction.
      Maintain the original structure, tone, and formatting unless explicitly asked to change it.
      
      CRITICAL OUTPUT RULES:
      1. You must output the FULL MODIFIED DOCUMENT CONTENT. Do not just output the changes.
      2. Do not include any conversational preamble or explanation in the document output.
      3. The user's goal is to improve the document iteratively.`;

      if (isRefinementJiraMode) {
        refineSystemInstruction += `
            \n=== JIRA AGENT MODE ACTIVE ===
            You have full authorization to manage Jira tickets.
            Your capabilities:
            - Create Epics, Stories, Tasks, Ideas.
            - Read and Search tickets (use JQL for search).
            - Update ticket fields.
            - Delete tickets (Use CAUTION).
            - Transition tickets through workflow states.

            If the user asks to perform a Jira action, call the appropriate tool.
            If the user just wants to edit the document, proceed with the document modification.
          `;
      }

      const refineUserPrompt = `
      CURRENT DOCUMENT CONTENT:
      ${previewOutput}

      USER INSTRUCTION:
      ${userMessage}

      Provide the fully updated document content below (OR call a tool if requested):
      `;

      // Using ANALYSIS_MAIN capability for high quality editing
      const result = await callGeminiAgent(
        GeminiCapability.ANALYSIS_MAIN,
        refineSystemInstruction,
        refineUserPrompt,
        [],
        false,
        false,
        selectedModel, // Apply the selected model override
        isRefinementJiraMode ? JIRA_TOOLS : undefined
      );

      // CHECK FOR TOOL CALLS
      if (isRefinementJiraMode && result.toolCall) {
        const toolCall = result.toolCall;
        setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `⚙️ Executing Jira Action: ${toolCall.name}...` }]);

        // Config for Jira Agent
        const config = {
          projectKey: (process.env as any).VITE_JIRA_PROJECT_KEY || '',
          email: (process.env as any).VITE_JIRA_EMAIL || '',
          apiToken: (process.env as any).VITE_JIRA_API_TOKEN || '',
          domain: (process.env as any).VITE_JIRA_DOMAIN || ''
        };


        // Intercept DELETE for confirmation
        if (toolCall.name === 'delete_ticket') {
          setPendingRefinementToolCall(toolCall);
          setConfirmation({
            type: 'DELETE_JIRA_TICKET' as any,
            payload: toolCall,
            title: "⚠️ Confirm Deletion",
            message: `You are about to DELETE a Jira ticket (${toolCall.args.issueKey}). This action cannot be undone. Are you sure?`,
            confirmLabel: "Yes, Delete Ticket",
            isDestructive: true
          } as any);

          setIsRefining(false);
          return;
        }

        try {
          const toolResult = await jiraAgent.executeJiraTool(toolCall, config);
          setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `✅ Action Complete: ${toolResult}` }]);
        } catch (err: any) {
          setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `❌ Action Failed: ${err.message}` }]);
        }
        setIsRefining(false);
        return;
      }

      setPreviewOutput(result.text);
      setRefinementChatHistory(prev => [...prev, { role: 'ai', text: "I've updated the document based on your request. Check the preview!" }]);

    } catch (error: any) {
      console.error("Refinement failed:", error);
      alert(`Refinement Error: ${error.message || "Unknown error"}`);
      setRefinementChatHistory(prev => [...prev, { role: 'ai', text: "Sorry, I encountered an error while processing your request. Please try again." }]);
    } finally {
      if (!pendingRefinementToolCall) {
        setIsRefining(false);
      }
    }
  };

  const activeEditMode = () => {
    setTempOutput(currentStageData.output);
    setIsEditingOutput(true);
  };

  const saveEdit = () => {
    setState(prev => ({
      ...prev,
      stages: {
        ...prev.stages,
        [state.currentStage]: {
          ...prev.stages[state.currentStage],
          output: tempOutput
        }
      }
    }));
    setIsEditingOutput(false);
  };

  const cancelEdit = () => {
    setIsEditingOutput(false);
    setTempOutput('');
  };

  const revertToVersion = (version: any) => {
    // Permission Check
    if (!canManageStageIterations) {
      setToast({ message: "You don't have permission to restore versions.", type: 'error' });
      return;
    }

    setConfirmation({
      type: 'RESTORE',
      payload: version,
      title: "Restore Version",
      message: "Restore this version? Your current output for this stage will be replaced.",
      confirmLabel: "Restore",
      isDestructive: true
    });
  };

  const performRevertVersion = async (version: any) => {
    try {
      setState(prev => ({
        ...prev,
        stages: {
          ...prev.stages,
          [state.currentStage]: {
            ...prev.stages[state.currentStage],
            output: version.output,
            input: version.input, // Restore input as well
            questions: version.questions, // Restore questions
            coherenceScore: version.coherenceScore, // Restore coherence score
            searchEntryPointHtml: version.searchEntryPointHtml, // Restore search entry point
            status: 'completed' // Mark as completed
          }
        }
      }));
      setShowHistory(false);
      setToast({ message: "Version restored successfully.", type: 'success' });
    } catch (err) {
      console.error("Revert failed", err);
      setToast({ message: "Failed to restore version.", type: 'error' });
    }
  };

  const closeRefinementModal = () => {
    setConfirmation({
      type: 'DISCARD_REFINEMENT',
      title: "Discard Changes",
      message: "Discard unsaved changes from this refinement session?",
      confirmLabel: "Discard",
      isDestructive: true
    });
  };

  const handleJiraSync = async () => {
    if (!jiraConfig.domain || !jiraConfig.email || !jiraConfig.apiToken || !jiraConfig.projectKey) {
      alert("Please fill in all Jira configuration fields.");
      return;
    }

    setIsJiraSyncing(true);
    setJiraSyncProgress("Initializing sync...");

    try {
      let domain = jiraConfig.domain;
      if (!domain.startsWith('http')) domain = 'https://' + domain;
      if (domain.endsWith('/')) domain = domain.slice(0, -1);

      await jiraService.syncBacklog(
        { ...jiraConfig, domain },
        currentStageData.output,
        (msg) => setJiraSyncProgress(msg)
      );

      setConfirmation({
        type: 'JIRA_SYNC_SUCCESS',
        title: "Sync Complete",
        message: "Success! Your backlog has been pushed to Jira.",
        confirmLabel: "OK",
        // No cancel label -> Single button mode
      });
      setShowJiraSync(false);
    } catch (err: any) {
      console.error(err);
      // setJiraSyncProgress is handled by the service catch block mostly
    } finally {
      setIsJiraSyncing(false);
    }
  };

  const exportData = async (type: 'md' | 'web' | 'pdf') => {
    if (!currentStageData.output) return;

    let mdContent = await marked.parse(currentStageData.output);

    // Append Intelligence Search Execution Results
    if (currentStageData.searchEntryPointHtml && currentStageData.searchEntryPointHtml.length > 20) {
      mdContent += `
        <div style="margin-top: 40px; border-top: 2px solid #e2e8f0; padding-top: 20px; page-break-inside: avoid;">
          <h3>Intelligence Search Execution</h3>
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; overflow-x: auto;">
            ${currentStageData.searchEntryPointHtml}
          </div>
        </div>
      `;
    }

    // Append Audit Trail (Grounding Sources)
    if (currentStageData.groundingSources && currentStageData.groundingSources.length > 0) {
      mdContent += `
        <div style="margin-top: 40px; border-top: 2px solid #e2e8f0; padding-top: 20px; page-break-inside: avoid;">
          <h3>Audit Trail & Verified References</h3>
          <ul style="list-style: none; padding-left: 0;">
            ${currentStageData.groundingSources.map(source => `
              <li style="margin-bottom: 8px;">
                <a href="${source.uri}" target="_blank" style="color: #4f46e5; text-decoration: none; font-weight: 600; font-size: 12px;">
                  ${source.title || source.uri}
                </a>
                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
                  Source: ${new URL(source.uri).hostname}
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    // Professional Report Structure
    const reportHeader = `
      <div class="report-header">
        <div>
          <div class="report-branding">PRSIM.AI MATERIAL+</div>
          <div class="report-title">Discovery Report: ${STAGE_CONFIGS[state.currentStage].title}</div>
        </div>
        <div class="report-meta">
          <div><strong>Project:</strong> ${state.projectMetadata.companyName || 'Untitled Project'}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          <div><strong>Status:</strong> ${currentStageData.status.toUpperCase()}</div>
        </div>
      </div>
    `;

    const fullHtml = `
      <div class="page-container">
        ${reportHeader}
        <div class="report-content">
          ${mdContent}
        </div>
        <div class="report-footer">
          Confidential Property of Material+ | Generated by PRSIM.AI
        </div>
      </div>
    `;

    const styles = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
        
        body { 
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; 
            background: #f1f5f9; 
            color: #1e293b; 
            line-height: 1.6; 
            margin: 0;
            padding: 40px;
            -webkit-print-color-adjust: exact;
        }
        
        .page-container {
            max-width: 800px;
            margin: 0 auto;
            background: #ffffff;
            padding: 60px;
            border-radius: 12px;
            box-shadow: 0 10px 30px -10px rgba(0,0,0,0.1);
        }

        /* HEADER */
        .report-header {
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 30px;
            margin-bottom: 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }
        .report-branding {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.25em;
            font-weight: 800;
            color: #6366f1;
            margin-bottom: 12px;
        }
        .report-title {
            font-size: 32px;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.1;
            letter-spacing: -0.02em;
        }
        .report-meta {
            text-align: right;
            font-size: 11px;
            color: #64748b;
            line-height: 1.8;
            border-left: 1px solid #e2e8f0;
            padding-left: 20px;
            margin-left: 20px;
        }

        /* TYPOGRAPHY */
        .report-content h1 { color: #0f172a; font-size: 24px; font-weight: 800; margin-top: 2em; margin-bottom: 1em; padding-bottom: 0.5em; border-bottom: 1px solid #e2e8f0; page-break-after: avoid; }
        .report-content h2 { color: #334155; font-size: 20px; font-weight: 700; margin-top: 2em; margin-bottom: 0.75em; page-break-after: avoid; }
        .report-content h3 { color: #334155; font-size: 16px; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.5em; page-break-after: avoid; }
        .report-content p { margin-bottom: 1.25em; text-align: justify; color: #475569; }
        .report-content li { margin-bottom: 0.5em; color: #475569; }
        .report-content strong { color: #0f172a; font-weight: 700; }

        /* TABLES */
        table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 2.5em 0; font-size: 13px; page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        th { background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.1em; padding: 16px; border-bottom: 1px solid #e2e8f0; }
        td { padding: 16px; border-bottom: 1px solid #f1f5f9; color: #475569; vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        tr:nth-child(even) td { background-color: #fcfcfc; }

        /* ELEMENTS */
        blockquote { border-left: 4px solid #6366f1; background: #f8fafc; margin: 2em 0; padding: 1.5em; font-style: italic; color: #475569; border-radius: 0 8px 8px 0; }
        code { background: #f1f5f9; padding: 3px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #ec4899; }
        pre { background: #1e293b; color: #e2e8f0; padding: 20px; border-radius: 8px; overflow-x: auto; margin: 2em 0; }
        pre code { background: transparent; color: inherit; padding: 0; }

        /* FOOTER */
        .report-footer {
            margin-top: 60px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #94a3b8;
        }

        @media print { 
            body { padding: 0; background: white; } 
            .page-container { width: 100%; max-width: none; padding: 40px; box-shadow: none; border-radius: 0; }
            button { display: none; }
            .no-print { display: none; }
            
            /* Print Optimizations */
            h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
            table, pre, blockquote, figure { break-inside: avoid; page-break-inside: avoid; }
            .report-header { break-inside: avoid; }
        }
      </style>
    `;

    if (type === 'web' || type === 'pdf') {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(`<!DOCTYPE html><html><head><meta charset='utf-8'><title>Discovery Report - ${state.projectMetadata.companyName}</title>${styles}</head><body>${fullHtml}${type === 'pdf' ? '<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 800); };</script>' : ''}</body></html>`);
        win.document.close();
      }
      return;
    }

    if (type === 'md') {
      const content = `<!DOCTYPE html><html><head><meta charset='utf-8'>${styles}</head><body>${fullHtml}</body></html>`;
      const blob = new Blob([content], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Discovery_Report_${state.currentStage}_${state.projectMetadata.companyName}.doc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  };

  const structuredBlocks = useMemo(() => {
    if (!currentStageData.output) return [];
    const blocks = currentStageData.output.split(/\n(?=#{2,3}\s)/);
    return blocks.filter(b => !b.toUpperCase().includes('CLARIFICATION QUESTIONS')).map(b => b.trim()).filter(b => b.length > 0);
  }, [currentStageData.output]);

  // --- Consolidated Confirmation Handler ---
  const handleConfirmAction = () => {
    if (!confirmation) return;

    switch (confirmation.type) {
      case 'RESET':
        performResetStage();
        break;
      case 'RESTORE':
        if (confirmation.payload) performRevertVersion(confirmation.payload);
        break;
      case 'DISCARD_REFINEMENT':
        setShowRefinementModal(false);
        setPreviewOutput('');
        setRefinementChatHistory([]);
        break;
      case 'DISCARD_EDIT': // Assuming this exists or will exist
      case 'CANCEL_EDIT':
        setIsEditingOutput(false);
        setTempOutput('');
        break;
      case 'JIRA_SYNC_SUCCESS':
        // Just close modal
        break;
      case 'DELETE_JIRA_TICKET' as any:
        if (pendingRefinementToolCall) {
          const config = {
            projectKey: (process.env as any).VITE_JIRA_PROJECT_KEY || '',
            email: (process.env as any).VITE_JIRA_EMAIL || '',
            apiToken: (process.env as any).VITE_JIRA_API_TOKEN || '',
            domain: (process.env as any).VITE_JIRA_DOMAIN || ''
          };
          setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `Confirmed. Deleting ticket...` }]);
          jiraAgent.executeJiraTool(pendingRefinementToolCall, config)
            .then(res => setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `✅ ${res}` }]))
            .catch(err => setRefinementChatHistory(prev => [...prev, { role: 'ai', text: `❌ Deletion Failed: ${err.message}` }]))
            .finally(() => {
              setPendingRefinementToolCall(null);
              setIsRefining(false);
            });
        }
        break;
    }
    setConfirmation(null);
  };

  const resetCurrentStage = async () => {
    // Permission Check
    if (!canManageStageIterations) {
      setToast({ message: "You don't have permission to reset stages.", type: 'error' });
      return;
    }

    setConfirmation({
      type: 'RESET',
      title: "Reset Module",
      message: "Are you sure you want to reset this module? All inputs and generated output for this stage will be permanently cleared.",
      confirmLabel: "Reset Module",
      isDestructive: true
    });
  };

  const performResetStage = async () => {
    try {
      // 1. Clear State locally
      setState(prev => ({
        ...prev,
        stages: {
          ...prev.stages,
          [state.currentStage]: {
            ...prev.stages[state.currentStage],
            input: '',
            output: '',
            files: [],
            urls: [],
            status: 'pending',
            questions: [],
            answers: {},
            versions: [],
            coherenceScore: 0,
            thinkingTemperature: undefined,
            thinkingTopP: undefined
          }
        },
        settings: {
          ...prev.settings,
          thinkingTemperature: 0.7,
          thinkingTopP: 0.95,
          isThinkingEnabled: false,
          isSearchEnabled: false
        }
      }));

      // 2. Clear in Firestore
      if (state.currentProject?.id) {
        await projectService.saveProjectStage(
          state.currentProject.id,
          state.currentStage,
          {
            input: '',
            output: '',
            files: [],
            urls: [],
            status: 'pending',
            questions: [],
            answers: {},
            versions: [],
            coherenceScore: 0,
            // @ts-ignore
            thinkingTemperature: null,
            // @ts-ignore
            thinkingTopP: null
          }
        );
      }

      setToast({ message: "Module successfully reset.", type: 'success' });
    } catch (error) {
      console.error("Reset failed", error);
      setToast({ message: "Failed to reset module.", type: 'error' });
    }
  };

  // Sidebar State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const SidebarContent = ({ isCollapsed = false, onToggle }: { isCollapsed?: boolean, onToggle?: () => void }) => (
    <>
      <div className={`mb-8 flex items-center ${isCollapsed ? 'justify-center flex-col gap-4' : 'justify-between px-2'} transition-all duration-300 relative`}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 shrink-0">
            <i className="fas fa-layer-group text-white text-lg"></i>
          </div>
          {!isCollapsed && (
            <div className="min-w-0 animate-in fade-in duration-300">
              <h1 className="text-lg font-black text-white tracking-tighter uppercase leading-none truncate">DISCOVERY PRO</h1>
              <p className="text-[9px] text-indigo-400 font-bold tracking-[0.2em] mt-1 uppercase">PRSIM.AI Material +</p>
            </div>
          )}
        </div>

        {/* Collapse Toggle Button (Desktop Only) */}
        {onToggle && (
          <button
            onClick={onToggle}
            className={`w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 ${isCollapsed ? 'mt-2' : ''}`}
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <i className={`fas fa-chevron-${isCollapsed ? 'right' : 'left'} text-xs`}></i>
          </button>
        )}
      </div>

      <div className={`flex-1 ${isCollapsed ? 'space-y-2' : 'space-y-4'}`}>
        <button
          onClick={() => setShowProjectConfig(true)}
          className={`w-full text-left rounded-2xl transition-all duration-300 group relative flex items-center gap-4 overflow-hidden border border-dashed border-indigo-500/30 hover:bg-indigo-600/10 hover:border-indigo-500 text-indigo-400 ${isCollapsed ? 'p-2 justify-center' : 'p-4'}`}
          title={isCollapsed ? "Global Context" : undefined}
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center shrink-0">
            <i className="fas fa-briefcase"></i>
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 animate-in fade-in duration-300">
              <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Global Context</div>
              <div className="text-[11px] font-bold truncate">{state.projectMetadata.companyName || 'Configure Project'}</div>
            </div>
          )}
          {!isCollapsed && <i className="fas fa-cog text-xs opacity-50"></i>}
        </button>

        <div className={`h-[1px] bg-slate-800/50 mx-2 my-2 ${isCollapsed ? 'mx-4' : ''}`}></div>

        {(Object.values(DiscoveryStage) as DiscoveryStage[]).map((stage, idx) => {
          const isActive = state.currentStage === stage;
          const isDone = state.stages[stage].status === 'completed';
          const isAnalyzing = analyzingStage === stage;
          const stageConfig = STAGE_CONFIGS[stage];
          return (
            <button
              key={stage}
              onClick={() => {
                setState(p => ({
                  ...p,
                  currentStage: stage,
                  settings: {
                    ...p.settings,
                    thinkingTemperature: p.stages[stage].thinkingTemperature ?? 0.7,
                    thinkingTopP: p.stages[stage].thinkingTopP ?? 0.95
                  }
                }));
                setIsMobileMenuOpen(false);
                setShowHistory(false);
              }}
              className={`w-full text-left rounded-2xl transition-all duration-300 group relative flex items-center gap-4 overflow-hidden border
                ${isActive ? 'bg-indigo-600/10 border-indigo-500/50 text-white shadow-inner' : 'hover:bg-slate-800/40 text-slate-500 border-transparent'}
                ${isCollapsed ? 'p-2 justify-center' : 'p-4'}
              `}
              title={isCollapsed ? stageConfig.title : undefined}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-all duration-500 shrink-0
                ${isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : isDone ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/50 text-slate-600 border border-slate-700/50'}
              `}>
                {isAnalyzing ? (
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                ) : isDone && !isActive ? (
                  <i className="fas fa-check"></i>
                ) : (
                  stageConfig.icon
                )}
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0 flex flex-col justify-center animate-in fade-in duration-300">
                  <div className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1 leading-none">Module 0{idx + 1}</div>
                  <div className={`text-[12px] font-bold leading-tight truncate ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-300'}`}>
                    {stageConfig.title}
                  </div>
                </div>
              )}
              {isActive && !isCollapsed && <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] animate-pulse ml-2"></div>}
            </button>
          );
        })}
      </div>

      <div className={`border-t border-slate-800/50 shrink-0 transition-all duration-300 ${isCollapsed ? 'pt-4 mt-4 border-transparent' : 'pt-6 mt-6'}`}>
        {/* Auth Profile Section */}
        <div className={`rounded-2xl bg-slate-800/40 border border-slate-700/50 flex items-center gap-3 mb-3 relative group cursor-pointer hover:bg-slate-800/60 transition-colors ${isCollapsed ? 'p-2 justify-center border-transparent bg-transparent hover:bg-transparent' : 'p-3'}`}
          onClick={() => setShowProjectList(true)}
          title={isCollapsed ? user?.displayName || 'User' : undefined}
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-slate-600 shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold border border-indigo-400 shrink-0">
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
          )}

          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0 animate-in fade-in duration-300">
                <div className="text-[11px] font-bold text-slate-200 truncate">{state.projectMetadata.companyName || 'Untitled Project'}</div>
                <div className="text-[9px] text-slate-500 truncate flex items-center gap-1">
                  <i className="fas fa-folder text-[8px]"></i>
                  <span>Switch Project</span>
                  <i className="fas fa-chevron-right text-[8px] ml-1 opacity-50"></i>
                </div>
              </div>

              {isAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAdminModal(true); }}
                  className="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 flex items-center justify-center text-rose-500 transition-colors shrink-0"
                  title="Admin Console"
                >
                  <i className="fas fa-users-cog text-xs"></i>
                </button>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); logout(); }}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors border border-slate-700 shrink-0"
                title="Sign Out"
              >
                <i className="fas fa-sign-out-alt text-xs"></i>
              </button>
            </>
          )}
        </div>

        <div className={`flex items-center gap-2 ${isCollapsed ? 'flex-col justify-center' : ''}`}>
          {/* Collapsed Mode Icons */}
          {isCollapsed && isAdmin && (
            <button
              onClick={() => setShowAdminModal(true)}
              className="w-10 h-10 p-0 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 flex items-center justify-center text-rose-500 transition-colors border border-rose-500/20 mb-2"
              title="Admin Console"
            >
              <i className="fas fa-users-cog text-xs"></i>
            </button>
          )}

          {/* Product Manual Button - Always Visible */}
          <button
            onClick={() => setShowManual(true)}
            className={`bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 flex items-center justify-center gap-2 group transition-all text-indigo-400 ${isCollapsed ? 'w-10 h-10 p-0 rounded-xl' : 'flex-1 p-3 rounded-2xl'}`}
            title="Product Manual"
          >
            <i className="fas fa-book-open text-xs group-hover:scale-110 transition-transform"></i>
            {!isCollapsed && <span className="text-[10px] font-bold uppercase tracking-wider">Manual</span>}
          </button>

          {/* Logout Button - Collapsed Mode Only */}
          {isCollapsed && (
            <button
              onClick={logout}
              className="w-10 h-10 p-0 rounded-xl mt-2 bg-slate-800 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/50 flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors"
              title="Sign Out"
            >
              <i className="fas fa-sign-out-alt text-xs"></i>
            </button>
          )}
        </div>

        {!isCollapsed && (
          <div className="mt-4 p-4 rounded-2xl bg-slate-950/50 border border-slate-800/50 text-[9px] text-slate-500 space-y-1 animate-in fade-in duration-300">
            <div className="flex justify-between"><span>Compute</span> <span className="text-slate-400">Gemini & Groq</span></div>
            <div className="flex justify-between"><span>Developed by</span> <span className="text-slate-400">M+ Product Team: <span className="text-amber-400 font-bold">BETA</span></span></div>
            <div className="flex justify-between"><span>Security</span> <span className="text-emerald-500 font-bold">ENCRYPTED</span></div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#020617] relative">
      <nav className={`hidden lg:flex bg-slate-900/40 border-r border-slate-800 flex-col backdrop-blur-3xl shrink-0 overflow-y-auto print:hidden transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'w-24 px-2 py-6' : 'w-80 p-6'}`}>
        <SidebarContent isCollapsed={isSidebarCollapsed} onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)} />
      </nav>

      <div
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <nav
          className={`absolute left-0 top-0 bottom-0 w-80 bg-slate-900 border-r border-slate-800 flex flex-col p-6 transition-transform duration-300 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-end mb-4 lg:hidden">
            <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 hover:text-white p-2">
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          <SidebarContent />
        </nav>
      </div>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="min-h-[5.5rem] sm:h-20 border-b border-slate-800 flex items-center justify-between px-4 sm:px-10 glass shrink-0 z-10 print:hidden py-3 sm:py-0">
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 min-w-0 pr-4">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0"
            >
              <i className="fas fa-bars"></i>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2 sm:gap-4">
                <h2 className="text-sm sm:text-lg font-bold text-white flex items-center gap-2 min-w-0 max-w-full">
                  <span className="truncate">{config.title}</span>
                  {currentStageData.status === 'completed' && <i className="fas fa-check-circle text-emerald-500 text-xs sm:text-sm shrink-0"></i>}
                  <span className={`hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ml-2
                    ${role === 'pro' ? 'bg-amber-500/10 border-amber-500/50 text-amber-500' :
                      role === 'standard' ? 'bg-blue-500/10 border-blue-500/50 text-blue-500' :
                        'bg-slate-700/50 border-slate-600 text-slate-400'}
                  `}>
                    {role === 'pro' && <i className="fas fa-crown text-[8px]"></i>}
                    {role}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  {state.settings.isThinkingEnabled && (
                    <span className="px-2 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[8px] sm:text-[9px] font-black text-indigo-400 tracking-widest uppercase flex items-center gap-1.5 shrink-0">
                      <i className="fas fa-brain text-[8px]"></i>
                      <span className="hidden xs:inline">Thinking</span>
                    </span>
                  )}
                  {state.settings.isSearchEnabled && (
                    <span className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[8px] sm:text-[9px] font-black text-amber-400 tracking-widest uppercase flex items-center gap-1.5 shrink-0">
                      <i className="fas fa-search text-[8px]"></i>
                      <span className="hidden xs:inline">Research</span>
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[9px] sm:text-[11px] text-slate-500 font-medium truncate hidden sm:block mt-1">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Thinking Mode Toggle (Only for Specific Models) */}
            {['gpt-oss-120b', 'gemini-2.5-pro'].includes(selectedModel) && (
              <button
                disabled={!canUseAdvancedAI}
                onClick={() => setState(prev => ({
                  ...prev,
                  settings: { ...prev.settings, isThinkingEnabled: !prev.settings.isThinkingEnabled }
                }))}
                className={`flex-1 p-5 rounded-2xl border transition-all duration-500 group flex flex-col items-center justify-center relative overflow-hidden h-10 w-10 
                  ${state.settings.isThinkingEnabled ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-400 hover:border-slate-600'}
                  ${!canUseAdvancedAI ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                title={!canUseAdvancedAI ? "Upgrade to enable Thinking Mode" : "Enhance reasoning with Gemini 2.0 Thinking Mode"}          >
                <i className={`fas fa-brain text-xs sm:text-sm z-10 ${state.settings.isThinkingEnabled ? 'animate-pulse' : ''}`}></i>
                {!canUseAdvancedAI && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><i className="fas fa-lock text-[8px] text-amber-500"></i></div>}
              </button>
            )}
            <button
              onClick={toggleVoice}
              disabled={!canEditProject}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all duration-500 border relative overflow-hidden group
                ${voice.isActive ? 'bg-indigo-600 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-indigo-400'}
                ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title={!canEditProject ? "Voice Assistant (View Only)" : "Voice Assistant"}
            >
              {voice.isSpeaking && <div className="absolute inset-0 bg-indigo-400/20 animate-pulse"></div>}
              <i className={`fas ${!canEditProject ? 'fa-microphone-slash' : voice.isActive ? 'fa-microphone' : 'fa-microphone-slash'} text-xs sm:text-sm z-10 ${voice.isSpeaking ? 'animate-bounce' : ''}`}></i>
            </button>

            {/* STAGE SPECIFIC ACTIONS */}
            {state.currentStage === DiscoveryStage.EPICS && currentStageData.status === 'completed' && (
              canExportData ? (
                <button
                  onClick={async () => {
                    const { generateEpicsExcel } = await import('./services/excelService');
                    generateEpicsExcel(currentStageData.output, `Epics_Estimation_${state.projectMetadata.companyName || 'Project'}.xlsx`);
                  }}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium transition-colors"
                  title="Export for Estimation"
                >
                  <i className="fas fa-file-excel"></i>
                  <span>Excel Export</span>
                </button>
              ) : (
                <button
                  disabled
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-emerald-400/50 cursor-not-allowed"
                  title="Permission required to export"
                >
                  <i className="fas fa-lock text-[10px] text-amber-500 mr-1"></i>
                  <span>Excel Export</span>
                </button>
              )
            )}

            <button
              onClick={() => exportData('pdf')}
              disabled={!canExportData}
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium
                ${canExportData
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                  : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'}
              `}
              title={canExportData ? "Export PDF" : "Permission required to export PDF"}
            >
              {!canExportData && <i className="fas fa-lock text-[9px] text-amber-500"></i>}
              <i className="fas fa-file-pdf"></i>
              <span className="hidden sm:inline ml-2">PDF</span>
            </button>

            <button

              onClick={() => setShowShareModal(true)}
              disabled={!canEditProject} // Basic check, modal handles permission details or we use canShareProject logic
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium
                ${canShareProject
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-800/50 text-slate-500 cursor-not-allowed'}
              `}
              title={canShareProject ? "Share Project" : "Upgrade to Pro to share"}
            >
              {!canShareProject && <i className="fas fa-lock text-[9px] text-amber-500"></i>}
              <i className="fas fa-user-plus"></i>
              <span className="hidden sm:inline ml-2">Share</span>
            </button>

            {currentStageData.output && (
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center transition-all duration-300 hover:scale-105 ${showHistory ? 'bg-indigo-600 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]' : ''}`}
                  title="Iteration History"
                >
                  <i className={`fas fa-history ${showHistory ? 'text-white' : 'text-indigo-400'}`}></i>
                </button>
                <button onClick={() => setIsPresenting(true)} className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center transition-transform hover:scale-105" title="Presentation Mode">
                  <i className="fas fa-desktop text-indigo-400"></i>
                </button>

                <button onClick={() => exportData('md')} className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center transition-transform hover:scale-105" title="Export Word">
                  <i className="fas fa-file-word text-indigo-400"></i>
                </button>
              </div>
            )}

            <button
              onClick={() => setShowManual(true)}
              className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-all flex items-center justify-center group relative shadow-lg shadow-black/20"
              title="User Manual"
            >
              <i className="fas fa-book text-[11px] group-hover:scale-110 transition-transform"></i>
            </button>



            <button
              onClick={resetCurrentStage}
              disabled={!canEditProject || !canManageStageIterations}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${(!canEditProject || !canManageStageIterations) ? 'text-slate-600 bg-slate-800 cursor-not-allowed opacity-50' : 'text-slate-400 hover:text-red-400 hover:bg-red-500/10'}`}
              title={!canManageStageIterations ? "Reset Stage (Requires Pro/Admin)" : "Reset Stage"}
            >
              <i className={`fas ${!canManageStageIterations ? 'fa-lock' : 'fa-redo-alt'}`}></i>
            </button>
          </div>
        </header >

        {
          voice.isActive && (
            <div className="bg-indigo-600/10 border-b border-indigo-500/20 px-6 py-2 flex items-center gap-4 animate-in slide-in-from-top-full duration-500 overflow-hidden print:hidden">
              <div className="flex gap-1 h-3 items-end shrink-0">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`w-0.5 bg-indigo-500 rounded-full transition-all duration-300 ${voice.isSpeaking || voice.isListening ? 'animate-[bounce_1s_infinite]' : 'h-1'}`} style={{ animationDelay: `${i * 0.1}s`, height: voice.isSpeaking || voice.isListening ? '100%' : '20%' }}></div>
                ))}
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 shrink-0">Assistant Active</p>
              <div className="h-4 w-px bg-indigo-500/20 shrink-0"></div>
              <p className="text-[11px] text-slate-300 font-medium italic truncate flex-1">{voice.transcript || 'Listening...'}</p>
              <button onClick={toggleVoice} className="text-[10px] font-bold text-rose-500 uppercase hover:text-rose-400 transition-colors px-2">Exit</button>
            </div>
          )
        }

        {/* Scroll Fade Helper */}
        {(() => {
          // Inline helper for scroll fade since we don't want to trigger re-renders
          const handleScrollFade = (e: React.UIEvent<HTMLDivElement>) => {
            const target = e.currentTarget;
            target.classList.add('is-scrolling');
            const timeoutId = (target as any)._scrollTimeout;
            if (timeoutId) clearTimeout(timeoutId);
            (target as any)._scrollTimeout = setTimeout(() => {
              target.classList.remove('is-scrolling');
            }, 800);
          };
          (window as any).handleScrollFade = handleScrollFade; // Expose to scope if needed, or just use inline closure below
          return null;
        })()}

        <div
          className="flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,#1e1b4b_0%,transparent_50%)] print:bg-white print:overflow-visible relative flex flex-col"
        >
          {/* VERSION HISTORY SIDE PANEL (Refined slide-over) */}
          < div
            className={`fixed inset-y-0 right-0 w-80 sm:w-96 z-[120] bg-slate-950/98 backdrop-blur-3xl border-l border-slate-800 shadow-[0_0_80px_rgba(0,0,0,0.9)] transition-transform duration-500 ease-in-out transform print:hidden flex flex-col
              ${showHistory ? 'translate-x-0' : 'translate-x-full'}
            `}
          >
            <div className="p-8 border-b border-slate-800 flex items-center justify-between bg-slate-900/40 shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
                  <i className="fas fa-history text-white text-sm"></i>
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest leading-none">Iterations</h3>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-2">{STAGE_CONFIGS[state.currentStage].title}</p>
                </div>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center text-slate-500 hover:text-white transition-all border border-slate-700/50 hover:border-slate-500"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {(!currentStageData.versions || currentStageData.versions.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-30 text-center px-10">
                  <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-6 border border-slate-700">
                    <i className="fas fa-folder-open text-2xl text-slate-600"></i>
                  </div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">No Iterations Found</h4>
                  <p className="text-[11px] font-medium text-slate-500 leading-relaxed italic">Generate your first analysis to begin tracking version history.</p>
                </div>
              ) : (
                currentStageData.versions.map((version, idx) => {
                  const isCurrent = currentStageData.output === version.output;
                  const iterNum = currentStageData.versions.length - idx;
                  const snapshot = version.output.replace(/[#*`\n]/g, ' ').trim().slice(0, 120);

                  return (
                    <div key={version.id} className="relative group animate-in slide-in-from-right-4 duration-500" style={{ animationDelay: `${idx * 0.05}s` }}>
                      <div className={`p-5 rounded-[1.5rem] border transition-all duration-300 relative overflow-hidden flex flex-col gap-3
                        ${isCurrent
                          ? 'bg-indigo-600/5 border-indigo-500/40 shadow-xl shadow-indigo-500/5 ring-1 ring-indigo-500/20'
                          : 'bg-slate-900/40 border-slate-800 hover:border-slate-600 hover:bg-slate-900/60 shadow-sm'}
                      `}>
                        {isCurrent && (
                          <div className="absolute top-0 right-0 px-3 py-1 bg-indigo-500 text-[8px] font-black uppercase tracking-tighter rounded-bl-xl text-white">
                            Current Workbench
                          </div>
                        )}

                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-indigo-500 animate-pulse' : 'bg-slate-700'}`}></div>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${isCurrent ? 'text-indigo-400' : 'text-slate-500'}`}>Iteration 0{iterNum}</span>
                          </div>
                          <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">
                            {new Date(version.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 font-medium line-clamp-3 leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                          {snapshot}...
                        </p>

                        {!isCurrent && (
                          <button
                            onClick={() => revertToVersion(version)}
                            disabled={!canEditProject || !canManageStageIterations}
                            className={`w-full mt-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${(!canEditProject || !canManageStageIterations) ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50' : 'bg-slate-800/80 border border-slate-700 text-indigo-400 hover:bg-indigo-600 hover:text-white hover:border-indigo-400'}`}
                            title={!canManageStageIterations ? "Restore Version (Requires Pro/Admin)" : "Restore Version"}
                          >
                            <i className={`fas ${!canManageStageIterations ? 'fa-lock' : 'fa-undo-alt'}`}></i> Restore Version
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-8 border-t border-slate-800 bg-slate-900/60 shrink-0 text-center">
              <p className="text-[8px] text-slate-600 uppercase font-black tracking-[0.2em] mb-1">Iteration Engine v2.0</p>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Snapshots are retained locally</p>
            </div>
          </div >



          {!isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-40 w-6 h-12 bg-indigo-600 rounded-r-xl flex items-center justify-center hover:bg-indigo-500 shadow-lg transition-all group"
              title="Expand Sidebar"
            >
              <i className="fas fa-chevron-right text-xs text-white group-hover:scale-110 transition-transform"></i>
            </button>
          )}
          <div className="max-w-[1400px] mx-auto p-4 sm:p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-6 items-stretch h-full print:block relative z-30">

            {isSidebarOpen && (
              <div
                onScroll={(e) => {
                  const target = e.currentTarget;
                  target.classList.add('is-scrolling');
                  const timeoutId = (target as any)._scrollTimeout;
                  if (timeoutId) clearTimeout(timeoutId);
                  (target as any)._scrollTimeout = setTimeout(() => {
                    target.classList.remove('is-scrolling');
                  }, 800);
                }}
                className="lg:col-span-5 space-y-6 lg:space-y-8 flex flex-col print:hidden animate-in slide-in-from-left-4 duration-300 h-full overflow-y-auto custom-scrollbar pr-2"
              >
                <div className="glass rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border-slate-700/50">
                  <div className="flex items-center justify-between mb-6 gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 whitespace-nowrap">Module Context</span>
                      {!canEditProject && (
                        <div className="bg-slate-900/90 border border-slate-700/50 rounded-md px-1.5 py-0.5 flex items-center gap-1.5 ml-2">
                          <i className="fas fa-lock text-[9px] text-slate-500"></i>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Read Only</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      {voice.isActive && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>}
                      {canEditProject && (
                        <VoiceInputTrigger
                          onStart={handleFieldVoice}
                          isListening={voice.isActive && !liveSessionRef.current}
                          size="sm"
                        />
                      )}
                      {canUseRefinementStudio && (
                        <RefineInputButton
                          text={currentStageData.input}
                          onRefine={(newText) => handleInputChange({ target: { value: newText } } as any)}
                          contextType={`Project Context for ${state.currentStage}`}
                          size="sm"
                        />
                      )}
                      {state.currentStage !== DiscoveryStage.DOMAIN && (
                        <button
                          onClick={importPrevious}
                          title="Import History from previous modules"
                          className="text-slate-500 hover:text-indigo-400 flex items-center justify-center transition-colors group border-l border-slate-700/50 pl-3 ml-1"
                        >
                          <i className="fas fa-cloud-download-alt text-sm group-hover:animate-bounce"></i>
                        </button>
                      )}
                      <button
                        onClick={() => setIsSidebarOpen(false)}
                        className="w-6 h-6 rounded-lg hover:bg-slate-800 flex items-center justify-center transition-colors group/collapse border-l border-slate-700/50 pl-2 ml-1"
                        title="Collapse Sidebar"
                      >
                        <i className="fas fa-chevron-left text-xs text-slate-500 group-hover/collapse:text-white"></i>
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <textarea
                      value={currentStageData.input}
                      onChange={handleInputChange}
                      readOnly={!canEditProject}
                      placeholder={config.placeholder}
                      className={`w-full h-48 sm:h-72 bg-slate-950/40 border rounded-2xl p-4 sm:p-5 text-sm text-slate-300 focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none shadow-inner font-light leading-relaxed
                      ${voice.isActive ? 'border-indigo-500/30' : 'border-slate-800'}
                      ${!canEditProject ? 'opacity-60 cursor-not-allowed' : ''}
                    `}
                    />
                  </div>

                  {/* URL Management Interface */}
                  <div className="mt-6 space-y-4">
                    {canEditProject && (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 group">
                          <input
                            type="text"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUrlAdd()}
                            placeholder="Add reference URL..."
                            className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all placeholder:text-slate-600"
                          />
                        </div>
                        <button
                          onClick={handleUrlAdd}
                          className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 transition-all"
                        >
                          <i className="fas fa-plus text-xs"></i>
                        </button>
                      </div>
                    )}

                    {currentStageData.urls && currentStageData.urls.length > 0 && (
                      <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                        {currentStageData.urls.map((url, idx) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg max-w-full">
                            <i className="fas fa-link text-[10px] text-indigo-400 shrink-0"></i>
                            <span className="text-[10px] font-bold text-slate-300 truncate max-w-[150px]">{url.replace(/^https?:\/\//, '')}</span>
                            {canEditProject && (
                              <button
                                onClick={() => handleUrlRemove(url)}
                                className="text-slate-500 hover:text-rose-500 transition-colors ml-1 shrink-0"
                              >
                                <i className="fas fa-times text-[10px]"></i>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-8 space-y-4">
                    <div>
                      {canEditProject && (
                        <div className="relative border-2 border-dashed border-slate-800 rounded-2xl p-4 group hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer text-center">
                          <input type="file" multiple accept="image/*,video/*,application/pdf,text/plain" onChange={(e) => handleFileUpload(e)} className="absolute inset-0 opacity-0 cursor-pointer" title="Attach Stage Assets" />
                          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                            <i className="fas fa-plus text-slate-400 group-hover:text-indigo-400"></i>
                          </div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Attach Stage Assets</p>
                        </div>
                      )}

                      {/* DYNAMIC ASSET LIST */}
                      {currentStageData.files.length > 0 && (
                        <div className="mt-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                          {currentStageData.files.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800 rounded-xl group transition-all hover:border-slate-700">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                                  <i className={`fas ${file.mimeType.startsWith('image/') ? 'fa-image text-indigo-400' : file.mimeType.startsWith('video/') ? 'fa-video text-amber-400' : 'fa-file-alt text-slate-400'} text-xs`}></i>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold text-slate-300 truncate">{file.name}</p>
                                  <p className="text-[9px] text-slate-500 uppercase tracking-tighter">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                              </div>
                              {canEditProject && (
                                <button
                                  onClick={() => removeFile(file.name)}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100"
                                  title="Remove asset"
                                >
                                  <i className="fas fa-times text-xs"></i>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {state.currentStage !== DiscoveryStage.DOMAIN && (
                      <div className={`relative border-2 border-dashed ${!canEditProject ? 'border-slate-800/50 bg-slate-900/20' : 'border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/5 cursor-pointer'} rounded-2xl p-4 group transition-all text-center`}>
                        {canEditProject ? (
                          !currentStageData.formatReference ? (
                            <>
                              <input type="file" accept="image/*,video/*,application/pdf,text/plain" onChange={(e) => handleFileUpload(e, true)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                                <i className="fas fa-file-signature text-slate-400 group-hover:text-indigo-400"></i>
                              </div>
                              <p className="text-[10px] font-bold text-slate-500 group-hover:text-indigo-400 uppercase tracking-widest transition-colors">Upload Format Reference</p>
                            </>
                          ) : (
                            <div className="relative z-20">
                              <div className="w-10 h-10 bg-emerald-600/20 rounded-full flex items-center justify-center mx-auto mb-2">
                                <i className="fas fa-check-circle text-emerald-400"></i>
                              </div>
                              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2">Reference Locked</p>
                              <div className="flex items-center justify-between gap-2 text-[9px] text-emerald-400 font-bold uppercase truncate px-3 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                <span className="truncate">{currentStageData.formatReference.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFormatReference(); }}
                                  className="text-emerald-500 hover:text-rose-500 transition-colors p-1 ml-2 relative z-30 pointer-events-auto"
                                  title="Remove reference"
                                >
                                  <i className="fas fa-times-circle text-sm"></i>
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          /* View Only State */
                          <div className="opacity-60 cursor-not-allowed">
                            {!currentStageData.formatReference ? (
                              <div className="flex flex-col items-center">
                                <div className="w-10 h-10 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-2">
                                  <i className="fas fa-ban text-slate-600"></i>
                                </div>
                                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">No Reference Format</p>
                              </div>
                            ) : (
                              <div className="relative z-20">
                                <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2">
                                  <i className="fas fa-file-alt text-slate-400"></i>
                                </div>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Reference Format</p>
                                <div className="inline-flex items-center justify-center gap-2 text-[9px] text-slate-400 font-bold uppercase truncate px-3 py-1 bg-slate-800/50 rounded-lg border border-slate-700">
                                  <span className="truncate">{currentStageData.formatReference.name}</span>
                                  <i className="fas fa-lock text-[8px] opacity-50 ml-1"></i>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-8 space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 transition-all hover:bg-indigo-500/10">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${state.settings.isThinkingEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                          <i className="fas fa-brain text-xs"></i>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Thinking Mode</p>
                          <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Enhanced Synthesis</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer group/lock">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          disabled={!canUseAdvancedAI}
                          checked={state.settings.isThinkingEnabled}
                          onChange={(e) => setState(prev => ({ ...prev, settings: { ...prev.settings, isThinkingEnabled: e.target.checked } }))}
                        />
                        <div className={`w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 ${!canUseAdvancedAI ? 'opacity-50' : ''}`}></div>
                        {!canUseAdvancedAI && <i className="fas fa-lock text-amber-500 text-xs absolute -left-5"></i>}
                      </label>
                    </div>

                    {/* Temperature Slider - Appears when Thinking Mode is enabled */}
                    {state.settings.isThinkingEnabled && (
                      <div className="mx-2 mt-2 p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 animate-in slide-in-from-top-1 fade-in duration-300">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Creativity Level</div>
                            <div className="group relative">
                              <i className="fas fa-info-circle text-[9px] text-indigo-400/50 hover:text-indigo-400 cursor-help transition-colors"></i>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                                <p className="text-[9px] text-slate-300 leading-relaxed font-medium">Controls randomness. Lower values are deterministic and focused; higher values are more creative and varied.</p>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-700"></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{state.settings.thinkingTemperature?.toFixed(1) ?? '0.7'}</div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={state.settings.thinkingTemperature ?? 0.7}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setState(prev => ({
                              ...prev,
                              settings: { ...prev.settings, thinkingTemperature: val },
                              stages: {
                                ...prev.stages,
                                [state.currentStage]: {
                                  ...prev.stages[state.currentStage],
                                  thinkingTemperature: val
                                }
                              }
                            }));
                          }}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <div className="flex justify-between mt-1.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">
                          <span>Precise</span>
                          <span>Creative</span>
                        </div>
                      </div>
                    )}

                    {/* TopP Slider - Appears when Thinking Mode is enabled */}
                    {state.settings.isThinkingEnabled && (
                      <div className="mx-2 mt-2 p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 animate-in slide-in-from-top-1 fade-in duration-300">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Diversity Level (Top P)</div>
                            <div className="group relative">
                              <i className="fas fa-info-circle text-[9px] text-indigo-400/50 hover:text-indigo-400 cursor-help transition-colors"></i>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none">
                                <p className="text-[9px] text-slate-300 leading-relaxed font-medium">Controls token selection diversity. Lower values limit to high-probability tokens; higher values allow more variety in word choice.</p>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-700"></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{state.settings.thinkingTopP?.toFixed(2) ?? '0.95'}</div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={state.settings.thinkingTopP ?? 0.95}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setState(prev => ({
                              ...prev,
                              settings: { ...prev.settings, thinkingTopP: val },
                              stages: {
                                ...prev.stages,
                                [state.currentStage]: {
                                  ...prev.stages[state.currentStage],
                                  thinkingTopP: val
                                }
                              }
                            }));
                          }}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <div className="flex justify-between mt-1.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">
                          <span>Focused</span>
                          <span>Diverse</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-500/5 border border-amber-500/10 transition-all hover:bg-amber-500/10">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${state.settings.isSearchEnabled ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                          <i className="fas fa-search text-xs"></i>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Research Grounding</p>
                          <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">External Validation</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer group/lock">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          disabled={!canUseAdvancedAI}
                          checked={state.settings.isSearchEnabled}
                          onChange={(e) => setState(prev => ({ ...prev, settings: { ...prev.settings, isSearchEnabled: e.target.checked } }))}
                        />
                        <div className={`w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600 ${!canUseAdvancedAI ? 'opacity-50' : ''}`}></div>
                        {!canUseAdvancedAI && <i className="fas fa-lock text-amber-500 text-xs absolute -left-5"></i>}
                      </label>
                    </div>
                  </div>

                  {!currentStageData.output && (
                    <>
                      <div className="mt-2 mb-3">
                        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/20 border border-slate-700/50 transition-all hover:bg-slate-800/40">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800 text-slate-400">
                              <i className="fas fa-microchip text-xs"></i>
                            </div>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Intelligence Engine</p>
                              <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Select Model</p>
                            </div>
                          </div>
                          <ModelSelector value={selectedModel} onChange={setSelectedModel} className="w-48" />
                        </div>
                      </div>

                      {/* System Instruction Customization (Pro/Admin) */}
                      <div className="mb-3 px-1">
                        <button
                          onClick={() => setIsInstructionModalOpen(true)}
                          disabled={!canCustomizeInstructions || !canEditProject}
                          className={`w-full py-2 rounded-xl flex items-center justify-between px-4 border text-[10px] font-bold uppercase tracking-wider transition-all
                                ${customInstructions[state.currentStage] ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300' : 'bg-slate-800/30 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}
                            `}
                        >
                          <div className="flex items-center gap-2">
                            <i className={`fas ${customInstructions[state.currentStage] ? 'fa-robot text-indigo-400' : 'fa-cog'}`}></i>
                            <span>System Instructions</span>
                          </div>
                          {!canCustomizeInstructions ? (
                            <i className="fas fa-lock text-slate-600"></i>
                          ) : (
                            <div className="flex items-center gap-2">
                              {customInstructions[state.currentStage] && <span className="text-[9px] bg-indigo-500/20 px-1.5 py-0.5 rounded text-indigo-300">MODIFIED</span>}
                              <i className="fas fa-chevron-right text-xs opacity-50"></i>
                            </div>
                          )}
                        </button>
                      </div>
                      <button
                        onClick={runAnalysis}
                        disabled={!!analyzingStage || (!currentStageData.input && currentStageData.files.length === 0) || !canEditProject}
                        title={!canEditProject ? "View Only Mode" : ""}
                        className="w-[98%] mx-auto py-3 sm:py-4 btn-grad rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-transform"
                      >
                        <div className="flex items-center gap-2.5">
                          {analyzingStage === state.currentStage ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <><i className={`fas ${!canEditProject ? 'fa-lock' : 'fa-wand-sparkles'} text-sm translate-y-[0.5px]`}></i><span>{config.cta}</span></>}
                        </div>
                      </button>
                    </>
                  )}
                </div>

                {currentStageData.output && (
                  <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-700">
                    {currentStageData.questions.length > 0 && (
                      <div className={`glass rounded-[2rem] p-6 sm:p-8 border shadow-xl space-y-6 sm:space-y-8
                      ${voice.isActive ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-500/20 bg-indigo-500/5'}
                    `}>
                        <div>
                          <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center"><i className="fas fa-lightbulb text-indigo-400 text-sm"></i></div>
                            <div>
                              <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Stage Refinement</h3>
                              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tighter">AI Needs Clarity</p>
                            </div>


                            {/* Removed Model Selector from Header */}
                          </div>
                          <div className="space-y-6">
                            {currentStageData.questions.map((q, i) => (
                              <div key={i} className="group relative">
                                <div className="flex items-center justify-between mb-2">
                                  <label className="block text-[10px] font-bold text-slate-400 leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity">{q}</label>
                                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {canEditProject && (
                                      <>
                                        <VoiceInputTrigger
                                          onStart={handleFieldVoice}
                                          isListening={voice.isActive && !liveSessionRef.current}
                                          size="sm"
                                        />
                                        <RefineInputButton
                                          text={currentStageData.answers[i.toString()] || ''}
                                          onRefine={(newText) => handleAnswerChange(i, newText)}
                                          contextType={`Answer to: ${q}`}
                                          size="sm"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <textarea
                                  rows={2}
                                  value={currentStageData.answers[i.toString()] || ''}
                                  onChange={(e) => handleAnswerChange(i, e.target.value)}
                                  readOnly={!canEditProject}
                                  className={`w-full bg-slate-950/60 border rounded-xl p-3 text-[11px] text-white outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all resize-none font-medium
                                  ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}
                                  ${voice.isActive ? 'border-indigo-500/40 shadow-[0_0_10px_rgba(99,102,241,0.1)]' : 'border-slate-800 focus:border-indigo-500/50'}
                                `}
                                  placeholder={canEditProject ? "Provide details..." : "No input provided"}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* System Instruction Visibility */}
                    {/* REGENERATION CONTROLS GROUP */}
                    <div className="flex flex-col gap-3">
                      {/* System Instruction Visibility */}
                      <div className="px-1">
                        <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/50 hover:bg-slate-900/50 transition-colors">
                          <details className="group">
                            <summary className="flex items-center justify-between cursor-pointer list-none">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${customInstructions[state.currentStage] ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-500'}`}>
                                  <i className="fas fa-robot text-xs"></i>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400 group-hover:text-slate-200 transition-colors">
                                    System Instruction {customInstructions[state.currentStage] ? <span className="text-indigo-400 shadow-indigo-500/20 drop-shadow-sm ml-1">● Customized</span> : <span className="text-slate-600 ml-1">● Default</span>}
                                  </p>
                                  <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Click to view prompt configuration</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {canCustomizeInstructions && canEditProject && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setIsInstructionModalOpen(true);
                                    }}
                                    className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-500 transition-colors flex items-center justify-center border border-slate-700/50 hover:border-indigo-500/50"
                                    title="Customize Instructions"
                                  >
                                    <i className="fas fa-pencil-alt text-[10px]"></i>
                                  </button>
                                )}
                                <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-slate-700 transition-colors">
                                  <i className="fas fa-chevron-down text-slate-500 text-[10px] transition-transform group-open:rotate-180"></i>
                                </div>
                              </div>
                            </summary>
                            <div className="mt-4 pt-4 border-t border-slate-800/50 animate-in slide-in-from-top-2 duration-300">
                              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/50">
                                <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed custom-scrollbar max-h-64 overflow-y-auto">
                                  {customInstructions[state.currentStage] || STAGE_CONFIGS[state.currentStage].systemInstruction}
                                </pre>
                              </div>
                            </div>
                          </details>
                        </div>
                      </div>

                      {/* REGENERATION MODEL SELECTOR */}
                      <div>
                        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-700/50 transition-all hover:bg-slate-800/60">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800 text-slate-400">
                              <i className="fas fa-microchip text-xs"></i>
                            </div>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Intelligence Engine</p>
                              <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Select Model</p>
                            </div>
                          </div>
                          <ModelSelector value={selectedModel} onChange={setSelectedModel} className="w-48" />
                        </div>
                      </div>

                      <button
                        onClick={runAnalysis}
                        disabled={!!analyzingStage || !canEditProject}
                        title={!canEditProject ? "View Only Mode" : ""}
                        className="w-[98%] mx-auto py-3 sm:py-4 btn-grad rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed shadow-xl shadow-indigo-500/10 transition-transform"
                      >
                        <div className="flex items-center gap-2.5">
                          {analyzingStage === state.currentStage ? (
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          ) : (
                            <>
                              <i className="fas fa-rotate text-sm translate-y-[0.5px]"></i>
                              <span>{config.regenerateCta || 'Re-Analyze Stage'}</span>
                            </>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              ref={mainScrollRef}
              onScroll={(e) => {
                const target = e.currentTarget;
                target.classList.add('is-scrolling');
                const timeoutId = (target as any)._scrollTimeout;
                if (timeoutId) clearTimeout(timeoutId);
                (target as any)._scrollTimeout = setTimeout(() => {
                  target.classList.remove('is-scrolling');
                }, 800);
              }}
              className={`${isSidebarOpen ? 'lg:col-span-7' : 'lg:col-span-12'} flex flex-col gap-6 lg:gap-8 print:block relative transition-all duration-300 h-full overflow-y-auto custom-scrollbar pr-2`}
            >


              {currentStageData.output ? (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-1000">
                  {/* Analysis Briefing Header */}
                  <div className="report-card !p-6 sm:!p-8 bg-indigo-600/5 border-indigo-500/20 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/40 shrink-0">
                        <i className="fas fa-shield-halved text-white text-xl"></i>
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-base font-black text-white uppercase tracking-tighter leading-none mb-1">Discovery Analysis Brief</h4>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest py-1 px-2 bg-indigo-500/10 rounded-md border border-indigo-500/20">Agent: {STAGE_CONFIGS[state.currentStage].agentName}</span>
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest py-1 px-2 bg-slate-800/40 rounded-md">ID: {state.currentStage}-{sessionId}</span>
                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest py-1 px-2 bg-emerald-500/10 rounded-md border border-emerald-500/20">Verified</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 w-full sm:w-auto border-t sm:border-t-0 border-slate-800 pt-4 sm:pt-0 group relative">
                      <div className="flex items-center gap-4">

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-help border-b border-dashed border-slate-700" title="Calculated based on Baseline Completeness, Input Depth, and Intelligence Leverage.">Coherence</span>
                          <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-[1.5s] ease-out" style={{ width: `${currentStageData.coherenceScore}%` }}></div>
                          </div>
                          <span className="text-[10px] font-black text-white uppercase tracking-widest ml-1">{currentStageData.coherenceScore}%</span>
                        </div>
                      </div>
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1 text-right w-full">{new Date().toLocaleDateString()} @ {new Date().toLocaleTimeString()}</p>
                    </div>
                  </div>

                  {/* JIRA INTEGRATION PANEL (New Feature) */}
                  {state.currentStage === DiscoveryStage.EPICS && (
                    <div className="report-card border-indigo-500/30 bg-indigo-600/5 mb-8">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-[#0052CC] rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <i className="fab fa-jira text-white text-lg"></i>
                          </div>
                          <div>
                            <h5 className="text-[12px] font-black uppercase tracking-widest text-indigo-400 leading-none mb-1 flex items-center gap-2">
                              Jira Cloud Synchronization
                              <div className="relative">
                                <i className="fas fa-info-circle text-indigo-600/50 hover:text-indigo-400 cursor-help transition-colors text-[10px] peer"></i>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-slate-200 text-[10px] font-medium rounded-lg opacity-0 peer-hover:opacity-100 transition-opacity whitespace-normal pointer-events-none shadow-xl border border-slate-700 z-10 w-64 text-center">
                                  Push your Epics and User Stories directly to Jira to start your development workflow.
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
                                </div>
                              </div>
                            </h5>
                            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-tighter">Workflow Integration</p>
                          </div>
                        </div>
                        {!showJiraSync ? (
                          <button
                            onClick={() => setShowJiraSync(true)}
                            disabled={!canSyncJira}
                            title={!canSyncJira ? "Permission required to Sync" : "Connect & Sync"}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all flex items-center gap-2 ${!canSyncJira ? 'bg-slate-700 cursor-not-allowed opacity-50' : 'bg-[#0052CC] hover:bg-[#0747A6]'}`}
                          >
                            <i className={`fas ${!canSyncJira ? 'fa-lock' : 'fa-plug'}`}></i> Connect & Sync
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowJiraSync(false)}
                            className="text-slate-500 hover:text-white transition-colors"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        )}
                      </div>

                      {showJiraSync && (
                        <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Jira URL</label>
                              <input
                                type="text"
                                placeholder="your-domain.atlassian.net"
                                value={jiraConfig.domain}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, domain: e.target.value.trim() })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Email</label>
                              <input
                                type="email"
                                placeholder="admin@company.com"
                                value={jiraConfig.email}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, email: e.target.value.trim() })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">API Token</label>
                              <input
                                type="password"
                                placeholder="ATATT3xF..."
                                value={jiraConfig.apiToken}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, apiToken: e.target.value.trim() })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Project Key</label>
                              <input
                                type="text"
                                placeholder="PROJ"
                                value={jiraConfig.projectKey}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, projectKey: e.target.value.trim() })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                          </div>
                          <div className="pt-4 border-t border-slate-800/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <p className="text-[10px] text-slate-500 italic max-w-sm">
                              {isJiraSyncing ? (
                                <span className="flex items-center gap-2 text-[#0052CC] font-bold animate-pulse">
                                  <i className="fas fa-spinner fa-spin"></i> {jiraSyncProgress}
                                </span>
                              ) : (
                                "This will parse the current backlog and create Epics and User Stories in your Jira project."
                              )}
                            </p>
                            <button
                              onClick={handleJiraSync}
                              disabled={isJiraSyncing}
                              className="w-full sm:w-auto px-8 py-3 rounded-xl bg-indigo-600 text-[10px] font-black text-white uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                            >
                              {isJiraSyncing ? "Syncing..." : "Start Push to Jira"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ESTIMATION STUDIO (Launch Card) */}
                  {state.currentStage === DiscoveryStage.EPICS && (
                    <div className="report-card border-emerald-500/30 bg-emerald-600/5 mb-8">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
                            <i className="fas fa-calculator text-white text-lg"></i>
                          </div>
                          <div>
                            <h5 className="text-[12px] font-black uppercase tracking-widest text-emerald-400 leading-none mb-1 flex items-center gap-2">
                              Estimation Studio
                              <div className="relative">
                                <i className="fas fa-info-circle text-emerald-600/50 hover:text-emerald-400 cursor-help transition-colors text-[10px] peer"></i>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-slate-200 text-[10px] font-medium rounded-lg opacity-0 peer-hover:opacity-100 transition-opacity whitespace-normal pointer-events-none shadow-xl border border-slate-700 z-10 w-64 text-center">
                                  Use the Estimation Studio to plan sprints, calculate effort, and define confidence levels.
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
                                </div>
                              </div>
                            </h5>
                            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-tighter">Technical Effort & Planning</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {state.stages[DiscoveryStage.EPICS].estimationSheetData && (
                            <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wide flex items-center gap-1.5 bg-emerald-900/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
                              <i className="fas fa-check-circle"></i> Saved
                            </span>
                          )}
                          <button
                            onClick={() => setShowEstimationStudio(true)}
                            disabled={!canUseEstimationStudio}
                            title={!canUseEstimationStudio ? "Permission required to Open Studio" : "Open Estimation Studio"}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black text-white uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg ${!canUseEstimationStudio ? 'bg-slate-700 cursor-not-allowed opacity-50 shadow-none' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'}`}
                          >
                            <i className={`fas ${!canUseEstimationStudio ? 'fa-lock' : 'fa-external-link-alt'}`}></i> Open Studio
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Main Content Sections */}
                  <div className="relative group">
                    {/* Content Actions Toolbar (Floating Overlay) */}
                    <div className="sticky top-2 z-30 flex justify-end px-2 h-0 overflow-visible pointer-events-none">
                      <div className="pointer-events-auto flex items-center gap-2 p-1.5 rounded-xl bg-slate-950 translate-y-3 mr-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        {!isEditingOutput ? (
                          <>
                            <button
                              onClick={openRefinementModal}
                              disabled={!canEditProject || !canUseRefinementStudio}
                              className={`w-8 h-8 rounded-lg ${canEditProject && canUseRefinementStudio ? 'bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/20' : 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'} text-white flex items-center justify-center transition-all group`}
                              title={!canUseRefinementStudio ? "Permission required" : canEditProject ? "Open AI Refinement Studio" : "Refinement Studio (View Only)"}
                            >
                              <i className="fas fa-wand-magic-sparkles text-xs group-hover:animate-pulse"></i>
                            </button>
                            <button
                              onClick={activeEditMode}
                              disabled={!canEditProject}
                              className={`w-8 h-8 rounded-lg bg-slate-800 ${canEditProject ? 'hover:bg-slate-700 hover:text-white text-slate-400' : 'text-slate-600 cursor-not-allowed opacity-50'} flex items-center justify-center transition-all`}
                              title={canEditProject ? "Manual Edit" : "Manual Edit (View Only)"}
                            >
                              <i className="fas fa-pencil-alt text-xs"></i>
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-all"
                            >
                              Cancel
                            </button>

                            <button
                              onClick={saveEdit}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold text-white uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/20"
                            >
                              Save Changes
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {isEditingOutput ? (
                      <div className="animate-in fade-in zoom-in-95 duration-200">
                        <textarea
                          value={tempOutput}
                          onChange={(e) => setTempOutput(e.target.value)}
                          className="w-full h-[60vh] bg-slate-950/40 border border-indigo-500/30 rounded-2xl p-6 md:p-8 text-sm md:text-base text-slate-300 font-mono leading-relaxed outline-none focus:ring-4 focus:ring-indigo-500/10 shadow-inner resize-none pt-14"
                          placeholder="Edit your analysis..."
                        />
                      </div>
                    ) : (
                      <div className="space-y-8">

                        {structuredBlocks.map((block, idx) => (
                          <div key={idx} className="report-card animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ animationDelay: `${idx * 0.1}s` }}>
                            <div className="flex justify-between items-start mb-6 -mt-2">
                              <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.4em]">Section 0{idx + 1}</span>
                            </div>
                            <MarkdownRenderer content={block} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Refinement Studio Inline Box REMOVED - Replaced by Modal */}

                  {/* COMPLETE AUDIT TRAIL: Intent -> Query -> Result */}
                  {(currentStageData.groundingSources || currentStageData.searchEntryPointHtml || (currentStageData.urls && currentStageData.urls.length > 0)) && (
                    <div className="report-card border-amber-500/20 bg-amber-500/5 mt-12 animate-in fade-in slide-in-from-bottom-6 duration-1000">
                      <div className="flex items-center justify-between mb-10 gap-4 flex-wrap">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center shadow-lg shadow-amber-500/10">
                            <i className="fas fa-magnifying-glass-chart text-amber-400 text-lg"></i>
                          </div>
                          <div>
                            <h5 className="text-[12px] font-black uppercase tracking-[0.2em] text-amber-400 leading-none mb-2">Research Grounding Audit Trail</h5>
                            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">End-to-End source verification logic</p>
                          </div>
                        </div>
                        <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[8px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                          <i className="fas fa-check-double"></i> Verified Research Session
                        </div>
                      </div>

                      <div className="space-y-12">
                        {/* 1. STRATEGIC INTENT (The Question) */}
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[10px] font-black text-amber-400">1</span>
                            <h6 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Strategic Intent (The Question)</h6>
                          </div>
                          <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-800/60 font-medium italic text-[11px] text-slate-400 leading-relaxed max-h-32 overflow-y-auto">
                            "{currentStageData.input.slice(0, 300)}{currentStageData.input.length > 300 ? '...' : ''}"
                          </div>
                        </div>

                        {/* 2. SEARCH EXECUTION (The Query) */}
                        {currentStageData.searchEntryPointHtml && (
                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[10px] font-black text-amber-400">2</span>
                              <h6 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Intelligence Search Execution (The Query)</h6>
                            </div>
                            <div className="bg-slate-950/80 p-6 rounded-3xl border border-slate-800 shadow-inner flex flex-col gap-4 transition-all hover:bg-slate-950">
                              <div className="w-full">
                                <p className="text-[11px] text-slate-400 leading-relaxed font-medium mb-1">Agent generated specific queries to validate current market data and technical benchmarks.</p>
                                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Engine: Google Grounding Pro</p>
                              </div>
                              <div className="search-entry-container w-full overflow-x-auto custom-scrollbar pb-2">
                                <div dangerouslySetInnerHTML={{ __html: currentStageData.searchEntryPointHtml }} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 3. GROUNDED CITATIONS (The Results) */}
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[10px] font-black text-amber-400">
                                {(currentStageData.groundingSources?.length || 0) + (currentStageData.urls?.length || 0)}
                              </span>
                              <h6 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Intelligence Evidence & Results</h6>
                            </div>
                            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Validated Sources</span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Grounding Sources (from Search) */}
                            {currentStageData.groundingSources?.map((source, idx) => (
                              <a
                                key={`ground-${idx}`}
                                href={source.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-5 p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 hover:border-amber-500/50 hover:bg-amber-500/10 transition-all group relative overflow-hidden"
                              >
                                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 group-hover:bg-amber-600 group-hover:border-amber-500 transition-all duration-300">
                                  <i className="fas fa-link text-[10px] text-slate-500 group-hover:text-white"></i>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12px] font-bold text-slate-200 truncate group-hover:text-amber-400 transition-colors mb-0.5">{source.title}</p>
                                  <p className="text-[9px] text-slate-600 truncate font-bold uppercase tracking-widest flex items-center gap-2">
                                    <span className="opacity-50">{new URL(source.uri).hostname}</span>
                                    <i className="fas fa-external-link text-[8px]"></i>
                                  </p>
                                </div>
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-amber-500/10 text-[7px] font-black text-amber-400 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">Grounding</div>
                              </a>
                            ))}

                            {/* Manual Reference URLs (from sidebar) */}
                            {currentStageData.urls?.map((url, idx) => (
                              <a
                                key={`manual-${idx}`}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-5 p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all group relative overflow-hidden"
                              >
                                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:border-indigo-500 transition-all duration-300">
                                  <i className="fas fa-bookmark text-[10px] text-slate-500 group-hover:text-white"></i>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12px] font-bold text-slate-200 truncate group-hover:text-indigo-400 transition-colors mb-0.5">{url.replace(/^https?:\/\//, '')}</p>
                                  <p className="text-[9px] text-slate-600 truncate font-bold uppercase tracking-widest flex items-center gap-2">
                                    <span className="opacity-50">{new URL(url).hostname}</span>
                                    <i className="fas fa-external-link text-[8px]"></i>
                                  </p>
                                </div>
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-[7px] font-black text-indigo-400 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">Manual Ref</div>
                              </a>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="py-12 flex flex-col items-center opacity-30 gap-4">
                    <div className="h-[1px] w-48 bg-gradient-to-r from-transparent via-slate-700 to-transparent"></div>
                    <span className="text-[9px] font-black uppercase tracking-[0.5em] text-slate-500">End of Technical Report</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-start pt-20 sm:pt-32 px-10 sm:px-20 text-center min-h-[60vh] relative overflow-hidden group">
                  {/* Decorative Elements for Empty State */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.05)_0%,transparent_70%)]"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[100px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>

                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 mb-10 relative">
                      <div className="absolute inset-0 border-2 border-slate-800 rounded-[2.5rem] rotate-45 group-hover:rotate-[225deg] group-hover:border-indigo-500/30 transition-all duration-[2s]"></div>
                      <div className="absolute inset-2 border-2 border-slate-800 rounded-[2.2rem] -rotate-12 group-hover:rotate-12 group-hover:border-indigo-500/20 transition-all duration-[2.5s]"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <i className="fas fa-microchip text-4xl text-slate-800 group-hover:text-indigo-500 group-hover:scale-110 transition-all duration-700"></i>
                      </div>
                    </div>

                    <h3 className="text-2xl sm:text-3xl font-black text-white mb-4 tracking-tighter uppercase">Workbench Terminal</h3>
                    <p className="max-w-md text-slate-400 leading-relaxed text-[13px] font-medium opacity-60 px-6">
                      System standing by. Provide strategic context in the left panel to initialize the <span className="text-indigo-400 font-bold">{config.title}</span> processing engine.
                    </p>



                    <div className="mt-12 flex gap-10 items-center opacity-30">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest">Latency</span>
                        <span className="text-xs font-bold text-white">2.4ms</span>
                      </div>
                      <div className="h-8 w-px bg-slate-800"></div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest">Model</span>
                        <span className="text-xs font-bold text-white">G3 PRO</span>
                      </div>
                      <div className="h-8 w-px bg-slate-800"></div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-black uppercase tracking-widest">Status</span>
                        <span className="text-xs font-bold text-emerald-500">READY</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div >
      </main >

      {
        (analyzingStage) && (
          <div className="fixed inset-0 z-[200] bg-[#020617]/95 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="max-w-md w-full flex flex-col items-center text-center">
              <div className="relative mb-12">
                <div className="w-40 h-40 sm:w-56 sm:h-56 border-2 border-indigo-500/10 rounded-full animate-[spin_8s_linear_infinite]"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-32 sm:w-44 sm:h-44 border-b-2 border-indigo-500/30 rounded-full animate-[spin_4s_linear_infinite]"></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 sm:w-32 sm:h-32 border-t-2 border-indigo-500 rounded-full animate-[spin_2s_linear_infinite]"></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center animate-pulse transition-all duration-1000 ${state.settings.isThinkingEnabled ? 'bg-indigo-600/20 shadow-[0_0_60px_rgba(99,102,241,0.4)]' : 'bg-indigo-500/10'}`}>
                    <i className={`fas ${state.settings.isThinkingEnabled ? 'fa-microchip' : 'fa-brain'} text-3xl sm:text-4xl text-indigo-500`}></i>
                  </div>
                </div>
              </div>

              <h4 className="text-2xl sm:text-3xl font-black text-white mb-4 tracking-tighter uppercase">
                {STAGE_CONFIGS[analyzingStage]?.agentName || 'Agent Processing'}
              </h4>

              <div className="h-10">
                <p className="text-indigo-400 text-sm sm:text-base font-bold tracking-[0.2em] animate-pulse uppercase">
                  {STAGE_CONFIGS[analyzingStage]?.statusMessages[statusIdx] || 'Synthesizing context...'}
                </p>
              </div>

              <div className="mt-12 w-48 h-1 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 animate-[progress_10s_linear_infinite]"></div>
              </div>
            </div>
          </div>
        )
      }

      {
        showProjectConfig && (
          <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="p-8 sm:p-12 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
                <div className="flex-1 pr-6">
                  <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-1">Strategic Baseline</h2>
                  <p className="text-xs text-indigo-400 font-bold uppercase tracking-[0.2em]">Optional Project Context</p>
                </div>

                <div className="flex items-center gap-6 shrink-0">


                  <div className="hidden sm:flex items-center gap-4 border-l border-slate-800 pl-8">
                    <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/40">
                      <i className="fas fa-layer-group text-white text-2xl"></i>
                    </div>
                    <div>
                      <div className="text-base font-black text-white tracking-tighter uppercase leading-none">DISCOVERY PRO</div>
                      <div className="text-[10px] text-indigo-400 font-bold tracking-[0.15em] mt-2 uppercase opacity-80">PRSIM.AI Material +</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 sm:p-12 space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Company Name</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.companyName}
                      onChange={(e) => handleMetadataChange('companyName', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="e.g. Material+"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Target Vertical</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.targetVertical}
                      onChange={(e) => handleMetadataChange('targetVertical', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="e.g. Fintech, Media, Sports"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Geography</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.geography}
                      onChange={(e) => handleMetadataChange('geography', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="e.g. NA, EMEA, Global..."
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">TAM / Market Focus</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.tam}
                      onChange={(e) => handleMetadataChange('tam', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="Market size or growth goal..."
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Revenue Model</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.revenueModel}
                      onChange={(e) => handleMetadataChange('revenueModel', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="e.g. Subscription, Ad-led..."
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Web Presence / References</label>
                    <input
                      type="text"
                      readOnly={!canEditProject}
                      value={state.projectMetadata.websiteUrls}
                      onChange={(e) => handleMetadataChange('websiteUrls', e.target.value)}
                      className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="URLs for business context..."
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Competitive Benchmark</label>
                  <textarea
                    rows={2}
                    readOnly={!canEditProject}
                    value={state.projectMetadata.keyCompetitors}
                    onChange={(e) => handleMetadataChange('keyCompetitors', e.target.value)}
                    className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                    placeholder="Who are we competing with?"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Core Mission</label>
                  <textarea
                    rows={3}
                    readOnly={!canEditProject}
                    value={state.projectMetadata.missionStatement}
                    onChange={(e) => handleMetadataChange('missionStatement', e.target.value)}
                    className={`w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none ${!canEditProject ? 'opacity-50 cursor-not-allowed' : ''}`}
                    placeholder="Ultimate vision for this project..."
                  />
                </div>
              </div>

              <div className="p-8 sm:p-12 border-t border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row justify-between items-center gap-8">

                <button
                  onClick={() => setShowProjectConfig(false)}
                  className="text-[11px] font-bold text-slate-500 uppercase tracking-widest hover:text-indigo-400 transition-colors flex items-center gap-2"
                >
                  Skip Optional Details <i className="fas fa-arrow-right"></i>
                </button>

                <button
                  onClick={() => setShowProjectConfig(false)}
                  className="w-full sm:w-auto px-16 py-5 btn-grad rounded-[2rem] text-[12px] font-black uppercase tracking-[0.25em] transition-all hover:px-20 shadow-lg shadow-indigo-900/20"
                >
                  Launch Workbench
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        isPresenting && (
          <PresentationView
            title={currentStageData.input.slice(0, 50) + "..."}
            stageName={config.title}
            content={currentStageData.output}
            onClose={() => setIsPresenting(false)}
          />
        )
      }

      {
        showManual && (
          <ProductManual onClose={() => setShowManual(false)} />
        )
      }

      <ChatBot appState={state} />

      <style>{`
        @keyframes progress {
           0% { transform: translateX(-100%); }
           100% { transform: translateX(100%); }
        }
        .search-entry-container a { color: #fbbf24 !important; text-decoration: none !important; font-weight: 800 !important; }
        .search-entry-container span { color: #94a3b8 !important; }
        
        /* Custom Scrollbar - Auto-hiding */
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 10px; transition: background 0.3s; }
        
        /* Show ONLY when scrolling (set via JS) */
        .custom-scrollbar.is-scrolling::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.4); }
      `}</style>
      {/* Immersive Refinement Modal */}
      {
        showRefinementModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-8 animate-in fade-in duration-300">
            <div className="w-full h-full max-w-[95vw] bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden">

              {/* Modal Header */}
              <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                    <i className="fas fa-wand-magic-sparkles text-white text-sm"></i>
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-3">
                      AI Refinement Studio
                      {voice.isActive && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full animate-in fade-in slide-in-from-left-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                          </span>
                          <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Listening</span>
                        </div>
                      )}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Collaborative Editing Session</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Jira Toggle - Only visible in EPICS stage */}
                  {state.currentStage === DiscoveryStage.EPICS && (
                    <button
                      onClick={() => setIsRefinementJiraMode(!isRefinementJiraMode)}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2
                                ${isRefinementJiraMode
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-400/50'}
                            `}
                      title="Enable Autonomous Jira Agent"
                    >
                      <i className="fab fa-jira"></i>
                      {isRefinementJiraMode ? 'Jira ON' : 'Jira OFF'}
                    </button>
                  )}
                  <ModelSelector
                    value={selectedModel}
                    onChange={setSelectedModel}
                    className="w-40"
                  />
                  <button
                    onClick={closeRefinementModal}
                    className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyRefinement}
                    className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                  >
                    <i className="fas fa-check"></i> Apply Changes
                  </button>
                </div>
              </div>

              {/* Modal Body: Split View */}
              <div className="flex-1 flex overflow-hidden">

                {/* LEFT: Live Preview (65%) */}
                <div className="flex-[2] border-r border-slate-800 bg-slate-950/50 flex flex-col min-w-0 relative">
                  {isRefining && (
                    <div className="absolute inset-0 z-10 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center flex-col gap-4 animate-in fade-in duration-300">
                      <div className="relative">
                        <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <i className="fas fa-magic text-indigo-400 text-xs animate-pulse"></i>
                        </div>
                      </div>
                      <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest animate-pulse">Refining Content...</p>
                    </div>
                  )}
                  <div className="h-10 border-b border-slate-800/50 flex items-center px-6 bg-slate-900/30">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Live Document Preview</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div className={`prose prose-invert max-w-none prose-sm transition-opacity duration-300 ${isRefining ? 'opacity-30' : 'opacity-100'}`}>
                      <MarkdownRenderer content={previewOutput} />
                    </div>
                  </div>
                </div>

                {/* RIGHT: Chat Interface (35%) */}
                <div className="flex-1 flex flex-col bg-slate-900/20 min-w-[350px]">
                  <div className="h-10 border-b border-slate-800/50 flex items-center px-6 bg-slate-900/30">
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">AI Editor Chat</span>
                  </div>

                  {/* Message History */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {refinementChatHistory.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-br-none'
                          : 'bg-slate-800 text-slate-300 rounded-bl-none border border-slate-700'
                          }`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {isRefining && (
                      <div className="flex justify-start">
                        <div className="bg-slate-800 rounded-2xl rounded-bl-none p-4 border border-slate-700 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"></div>
                          <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input Area */}
                  <div className="p-4 border-t border-slate-800 bg-slate-900/50">
                    <div className="relative">
                      <textarea
                        value={refinementInput}
                        onChange={(e) => setRefinementInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleRefineChat();
                          }
                        }}
                        placeholder="Type instructions to refine the document..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 pr-12 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500/50 outline-none resize-none h-24 transition-all"
                      />
                      <VoiceInputTrigger
                        onStart={() => handleFieldVoice(previewOutput || currentStageData.output)}
                        isListening={voice.isActive && !liveSessionRef.current}
                        size="md"
                        className="absolute bottom-3 right-12 shadow-lg"
                      />
                      <button
                        onClick={handleRefineChat}
                        disabled={isRefining || !refinementInput.trim()}
                        className="absolute bottom-3 right-3 w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                      >
                        <i className="fas fa-paper-plane text-xs"></i>
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-600 mt-2 text-center">AI can make mistakes. Review the preview before applying.</p>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )
      }
      <button onClick={() => setShowManual(true)} className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-slate-800 text-white shadow-lg flex items-center justify-center hover:bg-indigo-600 transition-colors z-40">
        <i className="fas fa-question text-xl"></i>
      </button>

      {/* Manual Modal */}
      {showManual && <ProductManual onClose={() => setShowManual(false)} />}

      {/* Project List Modal */}
      {
        showProjectList && (
          <ProjectListModal
            isOpen={showProjectList}
            onClose={() => setShowProjectList(false)}
            onSelectProject={loadProject}
            onProjectUpdated={handleProjectUpdated}
            activeProjectId={activeProjectId}
          />
        )
      }

      {
        showAdminModal && (
          <AdminUserModal
            isOpen={showAdminModal}
            onClose={() => setShowAdminModal(false)}
          />
        )
      }

      {
        showShareModal && activeProjectId && (
          <ShareProjectModal
            projectId={activeProjectId}
            projectName={state.projectMetadata.companyName || 'Untitled Project'}
            onClose={() => setShowShareModal(false)}
          />
        )
      }

      {/* ESTIMATION STUDIO FULL SCREEN OVERLAY */}
      {
        showEstimationStudio && (
          <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-in fade-in duration-300">
            {/* Note: Header is handled inside EstimationSheet with onClose prop */}
            <div className="flex-1 overflow-hidden">
              <EstimationSheet
                initialMarkdown={state.stages[DiscoveryStage.EPICS]?.output || ''}
                className="h-full rounded-none"
                onClose={() => setShowEstimationStudio(false)}
                onSave={(data) => {
                  setState(prev => ({
                    ...prev,
                    stages: {
                      ...prev.stages,
                      [DiscoveryStage.EPICS]: {
                        ...prev.stages[DiscoveryStage.EPICS],
                        estimationSheetData: data
                      }
                    }
                  }));
                }}
              />
            </div>
          </div>
        )
      }

      {/* GLOBAL MODALS */}
      <ConfirmationModal
        isOpen={!!confirmation}
        onClose={() => setConfirmation(null)}
        onConfirm={handleConfirmAction}
        title={confirmation?.title || ''}
        message={confirmation?.message || ''}
        confirmLabel={confirmation?.confirmLabel}
        isDestructive={confirmation?.isDestructive}
      />

      {
        toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )
      }
      <InstructionEditModal
        isOpen={isInstructionModalOpen}
        onClose={() => setIsInstructionModalOpen(false)}
        stage={state.currentStage}
        currentInstruction={customInstructions[state.currentStage]}
        onSave={handleSaveInstruction}
      />
    </div>
  );
};

export default App;
