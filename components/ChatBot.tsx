import React, { useState, useRef, useEffect } from 'react';
import { callGeminiAgent } from '../services/geminiService';
import { GeminiCapability } from '../services/modelConfig';
import { AppState, DiscoveryStage } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { STAGE_CONFIGS } from '../constants';
import ConfirmationModal from './common/ConfirmationModal';
import { JIRA_TOOLS, jiraAgent } from '../services/jiraAgent';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

interface ChatBotProps {
  appState: AppState;
}

const ChatBot: React.FC<ChatBotProps> = ({ appState }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your Discovery Assistant. I'm currently tracking your progress in **" + STAGE_CONFIGS[appState.currentStage].title + "**. How can I help?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastStageRef = useRef<DiscoveryStage>(appState.currentStage);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Jira Agent State
  const [isJiraMode, setIsJiraMode] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState<any>(null); // For storing delete requests waiting confirmation
  const [pendingContext, setPendingContext] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Only allow Jira Mode in EPICS stage
  const canUseJiraAgent = appState.currentStage === DiscoveryStage.EPICS;

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

  const executeTool = async (toolCall: any) => {
    const config = {
      projectKey: (import.meta.env.VITE_JIRA_PROJECT_KEY as string) || (process.env.VITE_JIRA_PROJECT_KEY as string) || '',
      email: (import.meta.env.VITE_JIRA_EMAIL as string) || (process.env.VITE_JIRA_EMAIL as string) || '',
      apiToken: (import.meta.env.VITE_JIRA_API_TOKEN as string) || (process.env.VITE_JIRA_API_TOKEN as string) || '',
      domain: (import.meta.env.VITE_JIRA_DOMAIN as string) || (process.env.VITE_JIRA_DOMAIN as string) || ''
    };

    if (!config.apiToken && isJiraMode) {
      return "Error: Jira API Tool is missing from environment. Please check VITE_JIRA_API_TOKEN.";
    }

    // Intercept DELETE for manual confirmation
    if (toolCall.name === 'delete_ticket') {
      setPendingToolCall(toolCall);
      setShowDeleteConfirm(true);
      return "WAITING_FOR_USER_CONFIRMATION";
    }

    return await jiraAgent.executeJiraTool(toolCall, config);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    if (pendingToolCall) {
      setIsTyping(true);
      // Execute the pending tool call
      const config = {
        projectKey: (import.meta.env.VITE_JIRA_PROJECT_KEY as string) || '',
        email: (import.meta.env.VITE_JIRA_EMAIL as string) || '',
        apiToken: (import.meta.env.VITE_JIRA_API_TOKEN as string) || '',
        domain: (import.meta.env.VITE_JIRA_DOMAIN as string) || ''
      };
      const result = await jiraAgent.executeJiraTool(pendingToolCall, config);
      setPendingToolCall(null);

      const contextToUse = pendingContext;
      setPendingContext(''); // Clear
      await continueConversationWithToolResult(result, contextToUse, 0); // Feed back result
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
        3. IF remaining actions exist (e.g. user asked for X and Y, and only X is done), CALL THE NEXT TOOL IMMEDIATELY (Recursive Action).
        4. IF request is fully complete, summarize the actions taken.
        
        DO NOT ask for permission to proceed with the next logical step of the same request. Just do it.
      `;

      // Pass tools again if we are in Jira Mode to allow chaining
      const toolsToEnable = isJiraMode ? JIRA_TOOLS : undefined;

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
        toolsToEnable // Recursion enablement
      );

      // CHECK FOR RECURSIVE TOOL CALLS
      if (isJiraMode && response.toolCall) {
        const toolCall = response.toolCall;
        setMessages(prev => [...prev, { role: 'assistant', content: `⚙️ **Chaining Action**: \`${toolCall.name}\`...` }]);

        const result = await executeTool(toolCall);

        // If manual confirmation is pending, we stop the recursion here.
        // It will resume from confirmDelete. We MUST save the context.
        if (result === "WAITING_FOR_USER_CONFIRMATION") {
          // Context is saved in pendingContext state (needs to be added to component)
          // But executeTool doesn't access state directly here.
          // We will handle this by returning the context requirement.
          // Actually, we need to update state in `executeTool` or `confirmDelete`.
          // Let's rely on the fact that confirmDelete will read from a new state variable `pendingContext`.
          setPendingContext(originalContext);
          return;
        }

        // RECURSE
        await continueConversationWithToolResult(result, originalContext, recursionDepth + 1);
        return;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
    } catch (err) {
      console.error("Error in follow-up generation:", err);
      setMessages(prev => [...prev, { role: 'assistant', content: `Tool Executed. Result: ${toolResult}` }]);
    } finally {
      // Only stop typing if we are truly done (not recursing)
      setIsTyping(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    setInput('');
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
            
            PROJECT KEY INSTRUCTION:
            You must identify the target Project Key.
            1. If the user specifies it (e.g., "in project KAN"), pass it as 'projectKey' in the tool call.
            2. If not specified, the system will try to use the default environment variable.
            3. If the tool fails due to missing Project Key, ASK THE USER for it.

            Your capabilities:
            - Create Epics, Stories, Tasks, Ideas.
            - Read and Search tickets (use JQL for search).
            - Update ticket fields.
            - Delete tickets (Use CAUTION).
            - Transition tickets through workflow states.

            CRITICAL INSTRUCTION:
            If the user asks to perform any of the above actions, YOU MUST CALL THE CORRESPONDING TOOL.
            DO NOT just say "I can do that" or "I have created it" without actually calling the function.
            Execute the tool FIRST, then summarize the result.
            
            Example:
            User: "Create a story about login"
            You: [Calls create_ticket function]
          `;
      } else {
        systemInstruction += `
            \nYOUR CAPABILITIES:
            1. Explain parts of the generated output.
            2. Help user phrase their inputs for better results.
            3. Provide industry benchmarks for the current vertical (${appState.projectMetadata.targetVertical}).
            4. Suggest answers to the refinement questions provided by the module agent.
            
            BEHAVIOR:
            - Stay in character as a professional consultant.
            - Be concise but insightful.
            - Reference the global mission and company name whenever providing strategic advice.
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

      if (isJiraMode) {
        console.log("[ChatBot] Invoking Gemini with JIRA TOOLS enabled.");
      } else {
        console.log("[ChatBot] Invoking Gemini in Standard Mode (No Jira Tools).");
      }

      const response = await callGeminiAgent(
        GeminiCapability.CHAT,
        systemInstruction,
        fullPrompt,
        [],
        false, // thinking
        false, // search
        undefined, // model override
        isJiraMode ? JIRA_TOOLS : undefined
      );

      // CHECK FOR TOOL CALLS
      if (isJiraMode && response.toolCall) {
        const toolCall = response.toolCall;
        setMessages(prev => [...prev, { role: 'assistant', content: `⚙️ **Executing Jira Action**: \`${toolCall.name}\`...` }]);

        const result = await executeTool(toolCall);

        // If manual confirmation is pending, we stop here.
        if (result === "WAITING_FOR_USER_CONFIRMATION") {
          setPendingContext(fullPrompt);
          return;
        }

        // Otherwise, render result
        await continueConversationWithToolResult(result, fullPrompt, 0);
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
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 rounded-t-[2.5rem]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <i className="fas fa-brain text-white text-sm"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-black text-white uppercase tracking-widest leading-none">Assistant</p>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[7px] font-black text-indigo-400 uppercase tracking-tighter">Pro</span>
              </div>
              <p className="text-[9px] text-slate-500 font-bold tracking-widest mt-1 uppercase truncate max-w-[150px]">
                {STAGE_CONFIGS[appState.currentStage].title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Jira Toggle */}
            {canUseJiraAgent && (
              <button
                onClick={() => setIsJiraMode(!isJiraMode)}
                className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2
                        ${isJiraMode
                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-400/50'}
                    `}
                title="Enable Autonomous Jira Agent"
              >
                <i className="fab fa-jira"></i>
                {isJiraMode ? 'Jira ON' : 'Jira OFF'}
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
              <div className={`max-w-[88%] p-4 rounded-2xl text-[13px] leading-relaxed shadow-sm
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
              placeholder={isJiraMode ? "Ask to create, read, update, or delete Jira tickets..." : "Ask for advice or refine details..."}
              className={`w-full bg-slate-950/90 border rounded-2xl px-5 py-4 text-[13px] text-white outline-none focus:ring-4 transition-all pr-14 placeholder:text-slate-600
                ${isJiraMode ? 'border-blue-900/50 focus:ring-blue-500/10 focus:border-blue-500/50' : 'border-slate-800 focus:ring-indigo-500/10 focus:border-indigo-500/50'}
              `}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`absolute right-3 w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all active:scale-95 shadow-lg
                ${isJiraMode ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20'}
              `}
            >
              <i className="fas fa-arrow-up"></i>
            </button>
          </div>
          <p className="text-[8px] text-slate-600 uppercase font-black tracking-[0.2em] mt-3 text-center opacity-60">
            {isJiraMode ? 'Powered by Autonomous Jira Agent' : 'Powered by Gemini Intelligence'}
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
    </div>
  );
};

export default ChatBot;
