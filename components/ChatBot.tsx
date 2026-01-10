import React, { useState, useRef, useEffect } from 'react';
import { callGeminiAgent } from '../services/geminiService';
import { GeminiCapability } from '../services/modelConfig';
import { AppState, DiscoveryStage } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { STAGE_CONFIGS } from '../constants';

interface Message {
  role: 'user' | 'assistant';
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

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
    if (window.confirm("Clear chat history? This will reset our conversation context.")) {
      setMessages([
        { role: 'assistant', content: `Context cleared. I'm still tracking your work in **${STAGE_CONFIGS[appState.currentStage].title}**. How can I help you start fresh?` }
      ]);
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

      const systemInstruction = `
        You are the "Discovery Pro AI Assistant", an expert product strategist.
        
        GLOBAL CONTEXT:
        - Company: ${appState.projectMetadata.companyName}
        - Mission: ${appState.projectMetadata.missionStatement}
        - Vertical: ${appState.projectMetadata.targetVertical}
        - Target Geography: ${appState.projectMetadata.geography}
        
        USER IS CURRENTLY IN: ${appState.currentStage} (${STAGE_CONFIGS[appState.currentStage].title})
        
        CURRENT MODULE STATE:
        - User Input: ${currentStageData.input || "[Empty]"}
        - AI Output: ${currentStageData.output ? "Already generated" : "Not yet analyzed"}
        - Refinement Questions Active: ${currentStageData.questions.length > 0 ? "Yes" : "No"}
        
        YOUR CAPABILITIES:
        1. Explain parts of the generated output.
        2. Help user phrase their inputs for better results.
        3. Provide industry benchmarks for the current vertical (${appState.projectMetadata.targetVertical}).
        4. Suggest answers to the refinement questions provided by the module agent.
        
        BEHAVIOR:
        - Stay in character as a professional consultant.
        - Be concise but insightful.
        - Reference the global mission and company name whenever providing strategic advice.
      `;

      // Construct history context for the stateless agent call
      const conversationHistory = messages.map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`).join('\n');
      const fullPrompt = `
CONVERSATION HISTORY:
${conversationHistory}

USER'S NEW MESSAGE:
${userMessage}
      `;

      const response = await callGeminiAgent(
        GeminiCapability.CHAT,
        systemInstruction,
        fullPrompt
      );

      const aiText = response.text;
      setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
    } catch (error) {
      console.error("ChatBot Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "Connection error. My intelligence engine is temporarily unavailable." }]);
    } finally {
      setIsTyping(false);
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
              placeholder="Ask for advice or refine details..."
              className="w-full bg-slate-950/90 border border-slate-800 rounded-2xl px-5 py-4 text-[13px] text-white outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 transition-all pr-14 placeholder:text-slate-600"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="absolute right-3 w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 disabled:grayscale transition-all hover:bg-indigo-500 active:scale-95 shadow-lg shadow-indigo-600/20"
            >
              <i className="fas fa-arrow-up"></i>
            </button>
          </div>
          <p className="text-[8px] text-slate-600 uppercase font-black tracking-[0.2em] mt-3 text-center opacity-60">
            Powered by Groq GPT-OSS Intelligence
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatBot;
