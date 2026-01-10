
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DiscoveryStage, AppState, FileContext, VoiceState, GroundingSource, ProjectMetadata, StageVersion } from './types';
import { STAGE_CONFIGS } from './constants';
import { callGeminiAgent } from './services/geminiService';
import { GeminiCapability } from './services/modelConfig';
import { scrapeUrl } from './services/webScraper';
import { jiraService } from './services/jiraService';
import { createLiveAssistant } from './services/liveService';
import { GroqVoiceAssistant } from './services/groqVoiceService';
import MarkdownRenderer from './components/MarkdownRenderer';
import PresentationView from './components/PresentationView';
import ChatBot from './components/ChatBot';
import ProductManual from './components/ProductManual';
import { marked } from 'marked';

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
  stages: {
    [DiscoveryStage.DOMAIN]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.BOD]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.KPI]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
    [DiscoveryStage.EPICS]: { input: '', output: '', files: [], urls: [], status: 'pending', questions: [], answers: {}, versions: [], coherenceScore: 0 },
  }
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [analyzingStage, setAnalyzingStage] = useState<DiscoveryStage | null>(null);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
  const [isSearchEnabled, setIsSearchEnabled] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [showProjectConfig, setShowProjectConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // Jira State
  const [showJiraSync, setShowJiraSync] = useState(false);
  const [isJiraSyncing, setIsJiraSyncing] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState('');
  const [jiraConfig, setJiraConfig] = useState({
    domain: (process.env as any).VITE_JIRA_DOMAIN || '',
    email: (process.env as any).VITE_JIRA_EMAIL || '',
    apiToken: (process.env as any).VITE_JIRA_API_TOKEN || '',
    projectKey: (process.env as any).VITE_JIRA_PROJECT_KEY || ''
  });

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

  useEffect(() => {
    if (!isMetadataComplete && !showProjectConfig) {
      setShowProjectConfig(true);
    }
  }, [isMetadataComplete, showProjectConfig]);

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
    if (isThinkingEnabled) score += 7.5;
    if (isSearchEnabled) score += 7.5;

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
    console.log("Starting Groq Voice Assistant (Fallback)...");
    liveSessionRef.current = new GroqVoiceAssistant({
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
    if (!isMetadataComplete) {
      setShowProjectConfig(true);
      return;
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
- Company Name: ${state.projectMetadata.companyName}
- Mission: ${state.projectMetadata.missionStatement}
- Target Vertical: ${state.projectMetadata.targetVertical}
- Geography: ${state.projectMetadata.geography}
- TAM: ${state.projectMetadata.tam}
- Revenue Model: ${state.projectMetadata.revenueModel}
- Global Websites: ${state.projectMetadata.websiteUrls}
- Competitors: ${state.projectMetadata.keyCompetitors}
      `;

      let userPrompt = `
${metadataContext}

CURRENT STAGE INPUT: ${stageData.input}
STAGE HISTORY: ${prevContext}
USER RESPONSES TO CLARIFICATIONS: ${JSON.stringify(filteredAnswers)}

STAGE-SPECIFIC REFERENCE URLS:
${(stageData.urls || []).join('\n')}

CRITICAL: If any visual assets (images or videos) or website URLs are provided, analyze them deeply. 
Extract UI components, user interactions, process flows, or product features visible in the assets 
and integrate these insights into the current discovery stage output. 
Use the Stage-Specific Reference URLs provided to gather deep technical or business context.
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

      const result = await callGeminiAgent(
        GeminiCapability.ANALYSIS_MAIN,
        STAGE_CONFIGS[targetStage].systemInstruction,
        finalUserPrompt,
        allFiles,
        isThinkingEnabled,
        isSearchEnabled
      );

      const finalCoherence = calculateCoherenceScore();

      setAnalyzingStage(current => {
        if (current === targetStage) {
          const questions = parseQuestions(result.text);
          setState(prev => {
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
          return null;
        }
        return current;
      });
    } catch (err) {
      console.error(err);
      alert("Analysis encountered a snag. Retrying often helps.");
    } finally {
      setAnalyzingStage(current => current === targetStage ? null : current);
    }
  };

  const revertToVersion = (version: StageVersion) => {
    if (window.confirm("Restore this version? Your current output for this stage will be replaced.")) {
      setState(prev => ({
        ...prev,
        stages: {
          ...prev.stages,
          [prev.currentStage]: {
            ...prev.stages[prev.currentStage],
            output: version.output,
            input: version.input,
            questions: version.questions,
            coherenceScore: version.coherenceScore,
            searchEntryPointHtml: version.searchEntryPointHtml,
            status: 'completed'
          }
        }
      }));
      setShowHistory(false);
    }
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

      alert("Success! Your backlog has been pushed to Jira.");
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

    const fullHtml = await marked.parse(currentStageData.output);
    const styles = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #ffffff; color: #334155; padding: 40px; line-height: 1.6; }
        .container { max-width: 800px; margin: 0 auto; background: #ffffff; padding: 20px; }
        h1 { color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; font-size: 24px; font-weight: 800; text-transform: uppercase; margin-bottom: 24px; }
        h2 { color: #4f46e5; margin-top: 32px; font-size: 20px; font-weight: 700; margin-bottom: 16px; }
        h3 { color: #1e293b; margin-top: 24px; font-size: 16px; font-weight: 700; }
        p, li { color: #334155; font-size: 14px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; margin: 24px 0; border: 1px solid #e2e8f0; font-size: 14px; }
        th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
        th { background: #f8fafc; color: #4f46e5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
        code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #4f46e5; }
        ul, ol { padding-left: 20px; margin-bottom: 20px; }
        @media print { body { padding: 0; } .container { width: 100%; max-width: none; } button { display: none; } }
      </style>
    `;

    if (type === 'web' || type === 'pdf') {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(`<!DOCTYPE html><html><head><meta charset='utf-8'><title>Discovery Report</title>${styles}</head><body><div class="container">${fullHtml}</div>${type === 'pdf' ? '<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); };</script>' : ''}</body></html>`);
        win.document.close();
      }
      return;
    }

    if (type === 'md') {
      const content = `<!DOCTYPE html><html><head><meta charset='utf-8'>${styles}</head><body><div class="container">${fullHtml}</div></body></html>`;
      const blob = new Blob([content], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Discovery_Report_${state.currentStage}.doc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  };

  const structuredBlocks = useMemo(() => {
    if (!currentStageData.output) return [];
    const blocks = currentStageData.output.split(/\n(?=#{2,3}\s)/);
    return blocks.filter(b => !b.toUpperCase().includes('CLARIFICATION QUESTIONS')).map(b => b.trim()).filter(b => b.length > 0);
  }, [currentStageData.output]);

  const resetCurrentStage = (e: React.MouseEvent) => {
    e.preventDefault();
    const stageToReset = state.currentStage;

    if (window.confirm("Are you sure you want to reset this module? All inputs and generated output for this stage will be permanently cleared.")) {
      if (analyzingStage === stageToReset) {
        setAnalyzingStage(null);
      }
      setIsPresenting(false);
      setState(prev => ({
        ...prev,
        stages: {
          ...prev.stages,
          [stageToReset]: {
            input: '',
            output: '',
            files: [],
            urls: [],
            formatReference: undefined,
            status: 'pending',
            questions: [],
            answers: {},
            groundingSources: undefined,
            searchEntryPointHtml: undefined,
            versions: [],
            coherenceScore: 0
          }
        }
      }));
    }
  };

  const SidebarContent = () => (
    <>
      <div className="mb-10 px-2 flex items-center gap-4">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 shrink-0">
          <i className="fas fa-layer-group text-white text-lg"></i>
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-white tracking-tighter uppercase leading-none truncate">DISCOVERY PRO</h1>
          <p className="text-[9px] text-indigo-400 font-bold tracking-[0.2em] mt-1 uppercase">PRSIM.AI Material +</p>
        </div>
      </div>

      <div className="flex-1 space-y-4">
        <button
          onClick={() => setShowProjectConfig(true)}
          className={`w-full text-left p-4 rounded-2xl transition-all duration-300 group relative flex items-center gap-4 overflow-hidden border border-dashed border-indigo-500/30 hover:bg-indigo-600/10 hover:border-indigo-500 text-indigo-400`}
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center shrink-0">
            <i className="fas fa-briefcase"></i>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Global Context</div>
            <div className="text-[11px] font-bold truncate">{state.projectMetadata.companyName || 'Configure Project'}</div>
          </div>
          <i className="fas fa-cog text-xs opacity-50"></i>
        </button>

        <div className="h-4"></div>

        {(Object.values(DiscoveryStage) as DiscoveryStage[]).map((stage, idx) => {
          const isActive = state.currentStage === stage;
          const isDone = state.stages[stage].status === 'completed';
          const isAnalyzing = analyzingStage === stage;
          const stageConfig = STAGE_CONFIGS[stage];
          return (
            <button
              key={stage}
              onClick={() => {
                if (isMetadataComplete) {
                  setState(p => ({ ...p, currentStage: stage }));
                  setIsMobileMenuOpen(false);
                  setShowHistory(false);
                }
              }}
              disabled={!isMetadataComplete}
              className={`w-full text-left p-4 rounded-2xl transition-all duration-300 group relative flex items-center gap-4 overflow-hidden border
                ${isActive ? 'bg-indigo-600/10 border-indigo-500/50 text-white shadow-inner' : 'hover:bg-slate-800/40 text-slate-500 border-transparent'}
                ${!isMetadataComplete ? 'opacity-30 cursor-not-allowed' : ''}
              `}
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
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1 leading-none">Module 0{idx + 1}</div>
                <div className={`text-[12px] font-bold leading-tight truncate ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-300'}`}>
                  {stageConfig.title}
                </div>
              </div>
              {isActive && <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] animate-pulse ml-2"></div>}
            </button>
          );
        })}
      </div>

      <div className="pt-6 border-t border-slate-800/50 mt-6 shrink-0">
        <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800/50 text-[9px] text-slate-500 space-y-1">
          <div className="flex justify-between"><span>Compute</span> <span className="text-slate-400">Grok-3</span></div>
          <div className="flex justify-between"><span>Team</span> <span className="text-slate-400">M+ Product Team : Beta</span></div>
          <div className="flex justify-between"><span>Security</span> <span className="text-emerald-500 font-bold">ENCRYPTED</span></div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#020617] relative">
      <nav className="hidden lg:flex w-80 bg-slate-900/40 border-r border-slate-800 flex-col p-6 backdrop-blur-3xl shrink-0 overflow-y-auto print:hidden">
        <SidebarContent />
      </nav>

      <div
        className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => isMetadataComplete && setIsMobileMenuOpen(false)}
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
                </h2>
                <div className="flex items-center gap-2">
                  {isThinkingEnabled && (
                    <span className="px-2 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[8px] sm:text-[9px] font-black text-indigo-400 tracking-widest uppercase flex items-center gap-1.5 shrink-0">
                      <i className="fas fa-brain text-[8px]"></i>
                      <span className="hidden xs:inline">Thinking</span>
                    </span>
                  )}
                  {isSearchEnabled && (
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
            <button
              onClick={toggleVoice}
              disabled={!isMetadataComplete}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all duration-500 border relative overflow-hidden group
                ${voice.isActive ? 'bg-indigo-600 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-indigo-400'}
                ${!isMetadataComplete ? 'opacity-30 cursor-not-allowed' : ''}
              `}
              title="Voice Assistant"
            >
              {voice.isSpeaking && <div className="absolute inset-0 bg-indigo-400/20 animate-pulse"></div>}
              <i className={`fas ${voice.isActive ? 'fa-microphone' : 'fa-microphone-slash'} text-xs sm:text-sm z-10 ${voice.isSpeaking ? 'animate-bounce' : ''}`}></i>
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
                <button onClick={() => exportData('pdf')} className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center transition-transform hover:scale-105" title="Export PDF">
                  <i className="fas fa-file-pdf text-rose-400"></i>
                </button>
                <button onClick={() => exportData('md')} className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center transition-transform hover:scale-105" title="Export Word">
                  <i className="fas fa-file-word text-indigo-400"></i>
                </button>
              </div>
            )}

            <button
              onClick={() => setShowManual(true)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl btn-action flex items-center justify-center shrink-0"
              title="Product Manual & FRD"
            >
              <i className="fas fa-book text-xs sm:text-sm text-indigo-400"></i>
            </button>

            <button
              onClick={resetCurrentStage}
              disabled={!isMetadataComplete}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl btn-reset flex items-center justify-center shrink-0 group relative overflow-hidden shadow-lg active:shadow-inner
                ${!isMetadataComplete ? 'opacity-30 cursor-not-allowed' : ''}
              `}
              title="Reset Stage"
            >
              <i className="fas fa-redo-alt text-xs sm:text-sm group-active:rotate-180 transition-transform duration-500"></i>
            </button>
          </div>
        </header>

        {voice.isActive && (
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
        )}

        <div
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_-20%,#1e1b4b_0%,transparent_50%)] print:bg-white print:overflow-visible relative"
        >
          {/* VERSION HISTORY SIDE PANEL (Refined slide-over) */}
          <div
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
                            className="w-full mt-2 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-[10px] font-black text-indigo-400 uppercase tracking-widest hover:bg-indigo-600 hover:text-white hover:border-indigo-400 transition-all flex items-center justify-center gap-2"
                          >
                            <i className="fas fa-undo-alt"></i> Restore Version
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
          </div>

          {!isMetadataComplete && (
            <div className="absolute inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"></div>
          )}

          <div className="max-w-[1400px] mx-auto p-4 sm:p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-stretch min-h-full print:block relative z-30">

            <div className="lg:col-span-5 xl:col-span-4 space-y-6 lg:space-y-8 flex flex-col print:hidden">
              <div className="glass rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border-slate-700/50">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Module Context</span>
                    {voice.isActive && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>}
                  </div>
                  {state.currentStage !== DiscoveryStage.DOMAIN && (
                    <button onClick={importPrevious} className="text-[10px] font-bold text-slate-500 hover:text-indigo-400 flex items-center gap-1.5 transition-colors group">
                      <i className="fas fa-cloud-download-alt group-hover:animate-bounce"></i> Import History
                    </button>
                  )}
                </div>

                <textarea
                  value={currentStageData.input}
                  onChange={handleInputChange}
                  placeholder={config.placeholder}
                  className={`w-full h-48 sm:h-72 bg-slate-950/40 border rounded-2xl p-4 sm:p-5 text-sm text-slate-300 focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none shadow-inner font-light leading-relaxed
                    ${voice.isActive ? 'border-indigo-500/30' : 'border-slate-800'}
                  `}
                />

                {/* URL Management Interface */}
                <div className="mt-6 space-y-4">
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

                  {currentStageData.urls && currentStageData.urls.length > 0 && (
                    <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                      {currentStageData.urls.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg max-w-full">
                          <i className="fas fa-link text-[10px] text-indigo-400 shrink-0"></i>
                          <span className="text-[10px] font-bold text-slate-300 truncate max-w-[150px]">{url.replace(/^https?:\/\//, '')}</span>
                          <button
                            onClick={() => handleUrlRemove(url)}
                            className="text-slate-500 hover:text-rose-500 transition-colors ml-1 shrink-0"
                          >
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-8 space-y-4">
                  <div>
                    <div className="relative border-2 border-dashed border-slate-800 rounded-2xl p-4 group hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer text-center">
                      <input type="file" multiple accept="image/*,video/*,application/pdf,text/plain" onChange={(e) => handleFileUpload(e)} className="absolute inset-0 opacity-0 cursor-pointer" title="Attach Stage Assets" />
                      <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                        <i className="fas fa-plus text-slate-400 group-hover:text-indigo-400"></i>
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Attach Stage Assets</p>
                    </div>

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
                            <button
                              onClick={() => removeFile(file.name)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100"
                              title="Remove asset"
                            >
                              <i className="fas fa-times text-xs"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {state.currentStage !== DiscoveryStage.DOMAIN && (
                    <div className="relative border-2 border-dashed border-slate-800 rounded-2xl p-4 group hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer text-center">
                      {!currentStageData.formatReference ? (
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
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-8 space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 transition-all hover:bg-indigo-500/10">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isThinkingEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                        <i className="fas fa-brain text-xs"></i>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Thinking Mode</p>
                        <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Enhanced Synthesis</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={isThinkingEnabled}
                        onChange={(e) => setIsThinkingEnabled(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-500/5 border border-amber-500/10 transition-all hover:bg-amber-500/10">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isSearchEnabled ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                        <i className="fas fa-search text-xs"></i>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-white leading-none">Research Grounding</p>
                        <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold tracking-widest">External Validation</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={isSearchEnabled}
                        onChange={(e) => setIsSearchEnabled(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                    </label>
                  </div>
                </div>

                {!currentStageData.output && (
                  <button
                    onClick={runAnalysis}
                    disabled={!!analyzingStage || (!currentStageData.input && currentStageData.files.length === 0)}
                    className="w-full mt-6 py-4 sm:py-5 btn-grad rounded-2xl text-[11px] sm:text-[12px] font-black uppercase tracking-[0.2em] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2.5">
                      {analyzingStage === state.currentStage ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <><i className="fas fa-wand-sparkles text-sm translate-y-[0.5px]"></i><span>{config.cta}</span></>}
                    </div>
                  </button>
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
                        </div>
                        <div className="space-y-6">
                          {currentStageData.questions.map((q, i) => (
                            <div key={i} className="group">
                              <label className="block text-[10px] font-bold text-slate-400 mb-2 leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity">{q}</label>
                              <textarea
                                rows={2}
                                value={currentStageData.answers[i.toString()] || ''}
                                onChange={(e) => handleAnswerChange(i, e.target.value)}
                                className={`w-full bg-slate-950/60 border rounded-xl p-3 text-[11px] text-white outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all resize-none font-medium
                                  ${voice.isActive ? 'border-indigo-500/40 shadow-[0_0_10px_rgba(99,102,241,0.1)]' : 'border-slate-800 focus:border-indigo-500/50'}
                                `}
                                placeholder="Provide details..."
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={runAnalysis}
                    disabled={!!analyzingStage}
                    className="w-full py-4 sm:py-5 btn-grad rounded-2xl text-[11px] sm:text-[12px] font-black uppercase tracking-[0.2em] flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed shadow-xl shadow-indigo-500/10"
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
              )}
            </div>

            <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-6 lg:gap-8 print:block relative">
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
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-help border-b border-dashed border-slate-700" title="Calculated based on Baseline Completeness, Input Depth, and Intelligence Leverage.">Coherence</span>
                        <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 transition-all duration-[1.5s] ease-out" style={{ width: `${currentStageData.coherenceScore}%` }}></div>
                        </div>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest ml-1">{currentStageData.coherenceScore}%</span>
                      </div>
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em]">{new Date().toLocaleDateString()} @ {new Date().toLocaleTimeString()}</p>
                    </div>
                  </div>

                  {/* JIRA INTEGRATION PANEL (New Feature) */}
                  {state.currentStage === DiscoveryStage.EPICS && (
                    <div className="report-card border-indigo-500/30 bg-indigo-600/5 mb-8 overflow-hidden group">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-[#0052CC] rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <i className="fab fa-jira text-white text-lg"></i>
                          </div>
                          <div>
                            <h5 className="text-[12px] font-black uppercase tracking-widest text-indigo-400 leading-none mb-1">Jira Cloud Synchronization</h5>
                            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-tighter">Bridge strategy to execution</p>
                          </div>
                        </div>
                        {!showJiraSync ? (
                          <button
                            onClick={() => setShowJiraSync(true)}
                            className="px-4 py-2 rounded-xl bg-[#0052CC] text-[10px] font-black text-white uppercase tracking-widest hover:bg-[#0747A6] transition-all flex items-center gap-2"
                          >
                            <i className="fas fa-plug"></i> Connect & Sync
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
                                onChange={(e) => setJiraConfig({ ...jiraConfig, domain: e.target.value })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Email</label>
                              <input
                                type="email"
                                placeholder="admin@company.com"
                                value={jiraConfig.email}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, email: e.target.value })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">API Token</label>
                              <input
                                type="password"
                                placeholder="ATATT3xF..."
                                value={jiraConfig.apiToken}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, apiToken: e.target.value })}
                                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-[11px] text-white outline-none focus:border-indigo-500/50"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Project Key</label>
                              <input
                                type="text"
                                placeholder="PROJ"
                                value={jiraConfig.projectKey}
                                onChange={(e) => setJiraConfig({ ...jiraConfig, projectKey: e.target.value })}
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

                  {/* Main Content Sections */}
                  <div className="space-y-8">
                    {structuredBlocks.map((block, idx) => (
                      <div key={idx} className="report-card animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ animationDelay: `${idx * 0.1}s` }}>
                        <div className="flex justify-between items-start mb-6 -mt-2">
                          <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.4em]">Section 0{idx + 1}</span>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="text-slate-500 hover:text-indigo-400 p-1 transition-colors"><i className="fas fa-copy text-xs"></i></button>
                          </div>
                        </div>
                        <MarkdownRenderer content={block} />
                      </div>
                    ))}
                  </div>

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
                            <div className="bg-slate-950/80 p-6 rounded-3xl border border-slate-800 shadow-inner flex flex-col sm:flex-row items-center justify-between gap-6 transition-all hover:bg-slate-950">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-slate-400 leading-relaxed font-medium mb-1">Agent generated specific queries to validate current market data and technical benchmarks.</p>
                                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Engine: Google Grounding Pro</p>
                              </div>
                              <div className="search-entry-container shrink-0">
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
                <div className="flex-1 flex flex-col items-center justify-center p-10 sm:p-20 text-center min-h-[60vh] relative overflow-hidden group">
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
        </div>
      </main>

      {analyzingStage && (
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
                <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center animate-pulse transition-all duration-1000 ${isThinkingEnabled ? 'bg-indigo-600/20 shadow-[0_0_60px_rgba(99,102,241,0.4)]' : 'bg-indigo-500/10'}`}>
                  <i className={`fas ${isThinkingEnabled ? 'fa-microchip' : 'fa-brain'} text-3xl sm:text-4xl text-indigo-500`}></i>
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
      )}

      {showProjectConfig && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-[3rem] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 sm:p-12 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
              <div className="flex-1 pr-6">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-1">Strategic Baseline</h2>
                <p className="text-xs text-indigo-400 font-bold uppercase tracking-[0.2em]">Mandatory Project Context</p>
              </div>

              <div className="flex items-center gap-4 shrink-0 border-l border-slate-800 pl-8">
                <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/40">
                  <i className="fas fa-layer-group text-white text-2xl"></i>
                </div>
                <div className="hidden sm:block">
                  <div className="text-base font-black text-white tracking-tighter uppercase leading-none">DISCOVERY PRO</div>
                  <div className="text-[10px] text-indigo-400 font-bold tracking-[0.15em] mt-2 uppercase opacity-80">PRSIM.AI Material +</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 sm:p-12 space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Company Name *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.companyName}
                    onChange={(e) => handleMetadataChange('companyName', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="e.g. Material+"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Target Vertical *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.targetVertical}
                    onChange={(e) => handleMetadataChange('targetVertical', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="e.g. Fintech, Media, Sports"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Geography *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.geography}
                    onChange={(e) => handleMetadataChange('geography', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="e.g. NA, EMEA, Global..."
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">TAM / Market Focus *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.tam}
                    onChange={(e) => handleMetadataChange('tam', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="Market size or growth goal..."
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Revenue Model *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.revenueModel}
                    onChange={(e) => handleMetadataChange('revenueModel', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="e.g. Subscription, Ad-led..."
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Web Presence / References *</label>
                  <input
                    type="text"
                    value={state.projectMetadata.websiteUrls}
                    onChange={(e) => handleMetadataChange('websiteUrls', e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all"
                    placeholder="URLs for business context..."
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Competitive Benchmark *</label>
                <textarea
                  rows={2}
                  value={state.projectMetadata.keyCompetitors}
                  onChange={(e) => handleMetadataChange('keyCompetitors', e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none"
                  placeholder="Who are we competing with?"
                />
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Core Mission</label>
                <textarea
                  rows={3}
                  value={state.projectMetadata.missionStatement}
                  onChange={(e) => handleMetadataChange('missionStatement', e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 text-sm text-white focus:ring-2 focus:ring-indigo-500/40 outline-none transition-all resize-none"
                  placeholder="Ultimate vision for this project..."
                />
              </div>
            </div>

            <div className="p-8 sm:p-12 border-t border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row justify-between items-center gap-8">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                {!isMetadataComplete ? <span className="text-rose-500">* All starred fields required</span> : <span className="text-emerald-500 flex items-center gap-2"><i className="fas fa-check"></i> Strategy Locked</span>}
              </p>
              <button
                onClick={() => isMetadataComplete && setShowProjectConfig(false)}
                disabled={!isMetadataComplete}
                className="w-full sm:w-auto px-16 py-5 btn-grad rounded-[2rem] text-[12px] font-black uppercase tracking-[0.25em] disabled:opacity-30 transition-all hover:px-20"
              >
                Launch Workbench
              </button>
            </div>
          </div>
        </div>
      )}

      {isPresenting && (
        <PresentationView
          title={currentStageData.input.slice(0, 50) + "..."}
          stageName={config.title}
          content={currentStageData.output}
          onClose={() => setIsPresenting(false)}
        />
      )}

      {showManual && (
        <ProductManual onClose={() => setShowManual(false)} />
      )}

      <ChatBot appState={state} />

      <style>{`
        @keyframes progress {
           0% { transform: translateX(-100%); }
           100% { transform: translateX(100%); }
        }
        .search-entry-container a { color: #fbbf24 !important; text-decoration: none !important; font-weight: 800 !important; }
        .search-entry-container span { color: #94a3b8 !important; }
      `}</style>
    </div>
  );
};

export default App;
