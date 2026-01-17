import React, { useState, useRef, useEffect } from 'react';
import { callGeminiAgent } from '../services/geminiService';
import { GeminiCapability } from '../services/modelConfig';
import { AppState, DiscoveryStage } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { STAGE_CONFIGS } from '../constants';
import ConfirmationModal from './common/ConfirmationModal';
import FigmaConfigModal from './FigmaConfigModal';
import JiraConfigModal from './JiraConfigModal';
import { JIRA_TOOLS, jiraAgent } from '../services/jiraAgent';
import { FIGMA_TOOLS, figmaAgent } from '../services/figmaAgent';
import { useRBAC } from '../src/hooks/useRBAC';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

interface ChatBotProps {
  appState: AppState;
}

const ChatBot: React.FC<ChatBotProps> = ({ appState }) => {
  const { canUseFigma } = useRBAC();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your Discovery Assistant. I'm currently tracking your progress in **" + STAGE_CONFIGS[appState.currentStage].title + "**. How can I help?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastStageRef = useRef<DiscoveryStage>(appState.currentStage);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Jira State
  const [isJiraMode, setIsJiraMode] = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [jiraConfig, setJiraConfig] = useState<{ domain: string; email: string; apiToken: string; projectKey: string }>({
    domain: (import.meta.env.VITE_JIRA_DOMAIN as string) || '',
    email: (import.meta.env.VITE_JIRA_EMAIL as string) || '',
    apiToken: (import.meta.env.VITE_JIRA_API_TOKEN as string) || '',
    projectKey: (import.meta.env.VITE_JIRA_PROJECT_KEY as string) || ''
  });

  // Figma State
  const [isFigmaMode, setIsFigmaMode] = useState(false);
  const [showFigmaModal, setShowFigmaModal] = useState(false);
  const [triggerFigmaAnalysis, setTriggerFigmaAnalysis] = useState(false); // New state for auto-trigger
  const [figmaConfig, setFigmaConfig] = useState<{ accessToken: string; fileKey: string }>({
    accessToken: (import.meta.env.VITE_FIGMA_ACCESS_TOKEN as string) || '',
    fileKey: (import.meta.env.VITE_FIGMA_FILE_KEY as string) || ''
  });

  const [pendingToolCall, setPendingToolCall] = useState<any>(null); // For storing delete requests waiting confirmation
  const [pendingContext, setPendingContext] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Only allow Jira Mode in EPICS stage (Legacy rule, maybe relax?)
  const canUseJiraAgent = appState.currentStage === DiscoveryStage.EPICS;
  const canUseFigmaAgent = canUseFigma;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (!canUseJiraAgent && isJiraMode) {
      setIsJiraMode(false);
    }
  }, [appState.currentStage]);

  // Handle auto-trigger for Figma
  useEffect(() => {
    if (isFigmaMode && triggerFigmaAnalysis && figmaConfig.fileKey) {
      setTriggerFigmaAnalysis(false);
      // Use a small timeout to ensure state propagation
      setTimeout(() => {
        handleSend(`Please analyze the structure of Figma file: ${figmaConfig.fileKey}. List the pages and top-level frames.`);
      }, 100);
    }
  }, [isFigmaMode, triggerFigmaAnalysis, figmaConfig.fileKey]);

  // Handle stage transitions
  useEffect(() => {
    if (lastStageRef.current !== appState.currentStage) {
      const newStageName = STAGE_CONFIGS[appState.currentStage].title;
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `🔄 **Context Switched**: I've synchronized with the **${newStageName}** module. I'm ready to assist with this specific stage.` }
      ]);
      lastStageRef.current = appState.currentStage;
    }
  }, [appState.currentStage]);

  const handleReset = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    setMessages([
      { role: 'assistant', content: `Context cleared. I'm still tracking your work in **${STAGE_CONFIGS[appState.currentStage].title}**. How can I help you start fresh?` }
    ]);
    setShowClearConfirm(false);
  };

  // --- JIRA HANDLERS ---
  const handleJiraToggle = () => {
    if (isJiraMode) {
      setIsJiraMode(false);
    } else {
      setShowJiraModal(true);
    }
  };

  const handleJiraConfigConfirm = (domain: string, email: string, apiToken: string, projectKey: string) => {
    setJiraConfig({ domain, email, apiToken, projectKey });
    setIsJiraMode(true);
    setShowJiraModal(false);
    setMessages(prev => [...prev, { role: 'assistant', content: `🛠️ **Jira Agent Enabled**\nConnected to project **${projectKey}** at ${domain}.` }]);
  };

  // --- FIGMA HANDLERS ---
  const handleFigmaToggle = () => {
    if (isFigmaMode) {
      setIsFigmaMode(false);
    } else {
      // Open Modal to configure
      setShowFigmaModal(true);
    }
  };

  const handleFigmaConfigConfirm = (accessToken: string, fileKey: string) => {
    setFigmaConfig({ accessToken, fileKey });
    setIsFigmaMode(true);
    setShowFigmaModal(false);

    // Feedback
    setMessages(prev => [...prev, { role: 'assistant', content: `🎨 **Figma Agent Enabled**\nConnected with provided token.` }]);

    // Enable trigger for useEffect
    if (fileKey) {
      setTriggerFigmaAnalysis(true);
    }
  };


  const executeTool = async (toolCall: any) => {
    // JIRA EXECUTION
    if (toolCall.name.startsWith('jira_') || toolCall.name.startsWith('create_') || toolCall.name.startsWith('delete_') || toolCall.name === 'get_issue' || toolCall.name === 'search_issues' || toolCall.name === 'update_issue' || toolCall.name === 'get_transitions' || toolCall.name === 'transition_issue') {
      const config = {
        projectKey: jiraConfig.projectKey,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
        domain: jiraConfig.domain
      };

      if (!config.apiToken && isJiraMode) {
        return "Error: Jira Credentials missing. Please re-enable Jira Agent.";
      }

      // Intercept DELETE for manual confirmation
      if (toolCall.name === 'delete_ticket') {
        setPendingToolCall(toolCall);
        setShowDeleteConfirm(true);
        return "WAITING_FOR_USER_CONFIRMATION";
      }

      return await jiraAgent.executeJiraTool(toolCall, config);
    }

    // FIGMA EXECUTION
    if (toolCall.name.startsWith('figma_')) {
      // PRIORITY: Modal Config -> Env Var
      const token = figmaConfig.accessToken ||
        (import.meta.env.VITE_FIGMA_ACCESS_TOKEN as string) ||
        (process.env.VITE_FIGMA_ACCESS_TOKEN as string) || '';

      const config = {
        accessToken: token
      };

      // If Request fails due to auth... well executeFigmaTool handles it.
      return await figmaAgent.executeFigmaTool(toolCall.name, toolCall.args, config);
    }

    return `Error: Unknown tool ${toolCall.name}`;
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    if (pendingToolCall) {
      setIsTyping(true);
      const config = {
        projectKey: jiraConfig.projectKey,
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
        domain: jiraConfig.domain
      };
      const result = await jiraAgent.executeJiraTool(pendingToolCall, config);
      setPendingToolCall(null);

      const contextToUse = pendingContext;
      setPendingContext(''); // Clear
      const stringResult = typeof result === 'string' ? result : JSON.stringify(result);
      await continueConversationWithToolResult(stringResult, contextToUse, 0); // Feed back result
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setPendingToolCall(null);
    setPendingContext('');
    setMessages(prev => [...prev, { role: 'assistant', content: "❌ **Action Cancelled**: Ticket deletion was aborted by user." }]);
  };

  const MAX_TOOL_RECURSION = 2;

  const continueConversationWithToolResult = async (toolResult: string, originalContext: string, recursionDepth: number = 0) => {
    try {
      // Safety Output
      console.log(`[ChatBot] Recursive Step ${recursionDepth}/${MAX_TOOL_RECURSION}. Previous Tool Result: ${toolResult.substring(0, 50)}...`);

      if (recursionDepth >= MAX_TOOL_RECURSION) {
        setMessages(prev => [...prev, { role: 'assistant', content: "⚠️ **Safety Limit Reached**: I've performed multiple actions in a row. To prevent loops, I'm pausing here. Please confirm if you want me to continue." }]);
        setIsTyping(false);
        return;
      }

      const systemInstruction = `
        You are the "Discovery Pro AI Assistant".
        You just executed a tool.
        
        PREVIOUS TOOL OUTPUT: ${toolResult}
        
        INSTRUCTIONS:
        1. Review the ORIGINAL USER REQUEST (below) and the TOOL OUTPUT.
        2. Identify if there are any *remaining* actions from the user's request that haven't been completed yet.
        3. IF remaining actions exist, CALL THE NEXT TOOL IMMEDIATELY (Recursive Action).
        4. IF request is fully complete, summarize the actions taken.
        
        DO NOT ask for permission to proceed with the next logical step of the same request. Just do it.
      `;

      // Pass tools again to allow chaining
      let toolsToEnable: any[] = [];
      if (isJiraMode) toolsToEnable = [...toolsToEnable, ...JIRA_TOOLS];
      if (isFigmaMode) toolsToEnable = [...toolsToEnable, ...FIGMA_TOOLS];

      const augmentedPrompt = `
      ${originalContext}

      ---
      SYSTEM UPDATE: The previous tool execution is complete. 
      Tool Result: ${toolResult}
      
      Decide your next move:
      - If there are more steps to fulfill the user's request, execute them now.
      - If done, report success.
      `;

      const response = await callGeminiAgent(
        GeminiCapability.CHAT,
        systemInstruction,
        augmentedPrompt,
        [],
        false,
        false,
        undefined,
        toolsToEnable.length > 0 ? toolsToEnable : undefined
      );

      // CHECK FOR TOOL CALLS
      if (response.toolCall) {
        const toolCall = response.toolCall;
        setMessages(prev => [...prev, { role: 'assistant', content: `⚙️ **Chaining Action**: \`${toolCall.name}\`...` }]);

        const result = await executeTool(toolCall);

        if (result === "WAITING_FOR_USER_CONFIRMATION") {
          setPendingContext(originalContext);
          return;
        }

        // RECURSE
        const stringResult = typeof result === 'string' ? result : JSON.stringify(result);
        await continueConversationWithToolResult(stringResult, originalContext, recursionDepth + 1);
        return;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
    } catch (err) {
      console.error("Error in follow-up generation:", err);
      setMessages(prev => [...prev, { role: 'assistant', content: `Tool Executed. Result: ${toolResult}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = async (manualInput?: string) => {
    const textToSend = manualInput || input;
    if (!textToSend.trim() || isTyping) return;

    const userMessage = textToSend.trim();
    if (!manualInput) setInput(''); // Only clear input if typed by user

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsTyping(true);

    try {
      const currentStageData = appState.stages[appState.currentStage];

      let systemInstruction = `
        You are the "Discovery Pro AI Assistant", an expert product strategist.
        
        GLOBAL CONTEXT:
        - Company: ${appState.projectMetadata.companyName}
        - Mission: ${appState.projectMetadata.missionStatement}
        - Vertical: ${appState.projectMetadata.targetVertical}
        - Target Geography: ${appState.projectMetadata.geography}
        
        USER IS CURRENTLY IN: ${appState.currentStage} (${STAGE_CONFIGS[appState.currentStage].title})
        
        CURRENT MODULE STATE:
        - User Input: ${currentStageData.output ? "See below" : currentStageData.input || "[Empty]"}
        - AI Output Status: ${currentStageData.output ? "GENERATED (Content Provided Below)" : "Not yet analyzed"}
        - Refinement Questions Active: ${currentStageData.questions.length > 0 ? "Yes" : "No"}

        === CURRENT MODULE OUTPUT CONTENT ===
        ${currentStageData.output || "No output generated yet."}
        =====================================
      `;

      if (isJiraMode) {
        systemInstruction += `
            \n=== JIRA AGENT MODE ACTIVE ===
            You have full authorization to manage Jira tickets.
            Capabilities: Create (Epic/Story/Task), Read, Update, Delete, Transition.
            Use 'search_issues' with JQL for finding tickets.
            Your Project Key is: ${jiraConfig.projectKey}
          `;
      }

      if (isFigmaMode) {
        systemInstruction += `
            \n=== FIGMA AGENT MODE ACTIVE ===
            You have authorization to read Figma files.
            Capabilities:
            - 'figma_get_file_structure': Get pages/layers.
            - 'figma_read_comments': Get comments.
            - 'figma_get_node_details': Get specific node info.
            
            Use this to understand design requirements or feedback.
            ${figmaConfig.fileKey ? `DEFAULT TARGET FILE KEY: ${figmaConfig.fileKey}. Use this if the user doesn't specify one.` : ''}
        `;
      }

      if (!isJiraMode && !isFigmaMode) {
        systemInstruction += `
            \nYOUR CAPABILITIES:
            1. Explain parts of the generated output.
            2. Help user phrase their inputs for better results.
            3. Provide industry benchmarks.
        `;
      }

      // Construct history context for the stateless agent call
      const conversationHistory = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
      const fullPrompt = `
CONVERSATION HISTORY:
${conversationHistory}

USER'S NEW MESSAGE:
${userMessage}
      `;

      console.log(`[ChatBot] Invoking Gemini. Jira: ${isJiraMode}, Figma: ${isFigmaMode}`);

      let toolsToEnable: any[] = [];
      if (isJiraMode) toolsToEnable = [...toolsToEnable, ...JIRA_TOOLS];
      if (isFigmaMode) toolsToEnable = [...toolsToEnable, ...FIGMA_TOOLS];

      const response = await callGeminiAgent(
        GeminiCapability.CHAT,
        systemInstruction,
        fullPrompt,
        [],
        false, // thinking
        false, // search
        undefined, // model override
        toolsToEnable.length > 0 ? toolsToEnable : undefined
      );

      // CHECK FOR TOOL CALLS
      if (response.toolCall) {
        const toolCall = response.toolCall;
        const agentName = toolCall.name.startsWith('figma') ? 'Figma' : 'Jira';
        setMessages(prev => [...prev, { role: 'assistant', content: `⚙️ **Executing ${agentName} Action**: \`${toolCall.name}\`...` }]);

        const result = await executeTool(toolCall);

        // If manual confirmation is pending, we stop here.
        if (result === "WAITING_FOR_USER_CONFIRMATION") {
          setPendingContext(fullPrompt);
          return;
        }

        // Otherwise, render result and handle recursion
        const stringResult = typeof result === 'string' ? result : JSON.stringify(result);
        await continueConversationWithToolResult(stringResult, fullPrompt, 0);
        return;
      }

      const aiText = response.text;
      setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
    } catch (error) {
      console.error("ChatBot Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Connection error. My intelligence engine is temporarily unavailable." }]);
    } finally {
      // If we are NOT waiting for confirmation, stop typing
      if (!showDeleteConfirm) {
        setIsTyping(false);
      }
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[150] print:hidden">
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl transition-all duration-500 group relative
          ${isOpen ? 'bg-slate-800 rotate-90 scale-90' : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-110'}
        `}
      >
        <div className="absolute inset-0 bg-indigo-400/20 rounded-2xl animate-pulse group-hover:animate-none"></div>
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comment-dots'} text-white text-xl z-10`}></i>
      </button>

      {/* Chat Window */}
      <div
        className={`absolute bottom-20 right-0 w-[350px] sm:w-[420px] h-[600px] rounded-[2.5rem] flex flex-col shadow-[0_30px_100px_rgba(0,0,0,0.8)] border border-slate-700/50 transition-all duration-500 transform origin-bottom-right
          ${isOpen ? 'scale-100 opacity-100 translate-y-0' : 'scale-0 opacity-0 translate-y-10 pointer-events-none'}
          bg-slate-950/98 backdrop-blur-3xl
        `}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/90 rounded-t-[2.5rem]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <i className="fas fa-brain text-white text-sm"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-black text-white uppercase tracking-widest leading-none">Assistant</p>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[7px] font-black text-indigo-400 uppercase tracking-tighter">Pro</span>
              </div>
              <p className="text-[9px] text-slate-500 font-bold tracking-widest mt-1 uppercase truncate max-w-[100px] sm:max-w-[140px]">
                {STAGE_CONFIGS[appState.currentStage].title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Jira Toggle */}
            {canUseJiraAgent && (
              <button
                onClick={handleJiraToggle}
                className={`px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5
                        ${isJiraMode
                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-400/50'}
                    `}
                title="Enable Autonomous Jira Agent"
              >
                <i className="fab fa-jira"></i>
                {isJiraMode ? 'ON' : 'OFF'}
              </button>
            )}

            {/* Figma Toggle */}
            {canUseFigmaAgent && (
              <button
                onClick={handleFigmaToggle}
                className={`px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5
                        ${isFigmaMode
                    ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/30'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-purple-400 hover:border-purple-400/50'}
                    `}
                title="Enable Figma Agent"
              >
                <i className="fab fa-figma"></i>
                {isFigmaMode ? 'ON' : 'OFF'}
              </button>
            )}


            <button
              onClick={handleReset}
              className="w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
              title="Reset Conversation"
            >
              <i className="fas fa-trash-alt text-[10px]"></i>
            </button>
            <div className="w-px h-6 bg-slate-800"></div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <i className="fas fa-chevron-down"></i>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] p-4 rounded-2xl text-[11.5px] leading-relaxed shadow-sm
                ${msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none shadow-indigo-600/10'
                  : 'bg-slate-900/90 text-slate-200 border border-slate-800 rounded-bl-none shadow-black/20'}
              `}>
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-slate-900/90 p-4 rounded-2xl rounded-bl-none border border-slate-800 flex gap-2 items-center">
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/90 rounded-b-[2.5rem]">
          <div className="relative flex items-center group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={isJiraMode || isFigmaMode ? "Send instructions to active agents..." : "Ask for advice or refine details..."}
              className={`w-full bg-slate-950/90 border rounded-2xl px-5 py-4 text-[13px] text-white outline-none focus:ring-4 transition-all pr-14 placeholder:text-slate-600
                ${isJiraMode || isFigmaMode ? 'border-indigo-900/50 focus:ring-indigo-500/10 focus:border-indigo-500/50' : 'border-slate-800 focus:ring-indigo-500/10 focus:border-indigo-500/50'}
              `}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`absolute right-3 w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all active:scale-95 shadow-lg
                ${isJiraMode || isFigmaMode ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20' : 'bg-slate-700 hover:bg-slate-600 shadow-slate-600/20'}
              `}
            >
              <i className="fas fa-arrow-up"></i>
            </button>
          </div>
          <p className="text-[8px] text-slate-600 uppercase font-black tracking-[0.2em] mt-3 text-center opacity-60">
            {isJiraMode && isFigmaMode ? 'Powered by Jira & Figma Agents' : isJiraMode ? 'Powered by Jira Agent' : isFigmaMode ? 'Powered by Figma Agent' : 'Powered by Gemini Intelligence'}
          </p>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={confirmClear}
        title="Clear Chat History"
        message="Are you sure you want to clear the chat history? This will reset our conversation context."
        confirmLabel="Clear History"
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        title="⚠️ Confirm Deletion"
        message={`You are about to DELETE a Jira ticket (${pendingToolCall?.args?.issueKey}). This action cannot be undone. Are you sure?`}
        confirmLabel="Yes, Delete Ticket"
        isDestructive={true}
      />

      <FigmaConfigModal
        isOpen={showFigmaModal}
        onClose={() => setShowFigmaModal(false)}
        onConfirm={handleFigmaConfigConfirm}
        initialAccessToken={figmaConfig.accessToken}
        initialFileKey={figmaConfig.fileKey}
      />

      <JiraConfigModal
        isOpen={showJiraModal}
        onClose={() => setShowJiraModal(false)}
        onConfirm={handleJiraConfigConfirm}
        initialDomain={jiraConfig.domain}
        initialEmail={jiraConfig.email}
        initialApiToken={jiraConfig.apiToken}
        initialProjectKey={jiraConfig.projectKey}
      />
    </div>
  );
};

export default ChatBot;
