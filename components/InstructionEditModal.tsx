import React, { useState, useEffect } from 'react';
import { DiscoveryStage } from '../types';
import { STAGE_CONFIGS } from '../constants';
import { callGeminiAgent } from '../services/geminiService';
import { callGroqAgent } from '../services/groqService';
import { GeminiCapability } from '../services/modelConfig';

interface InstructionEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    stage: DiscoveryStage;
    currentInstruction: string | undefined; // Undefined means use default
    onSave: (instruction: string | undefined) => void; // Undefined means reset to default
}

export const InstructionEditModal: React.FC<InstructionEditModalProps> = ({
    isOpen,
    onClose,
    stage,
    currentInstruction,
    onSave
}) => {
    const defaultConfig = STAGE_CONFIGS[stage];
    const [value, setValue] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const [isRefining, setIsRefining] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (currentInstruction) {
                setValue(currentInstruction);
                setIsCustom(true);
            } else {
                setValue(defaultConfig.systemInstruction);
                setIsCustom(false);
            }
        }
    }, [isOpen, currentInstruction, defaultConfig, stage]);

    if (!isOpen) return null;

    const handleSave = () => {
        // If value matches default exactly, treat as not custom
        if (value.trim() === defaultConfig.systemInstruction.trim()) {
            onSave(undefined);
        } else {
            onSave(value);
        }
        onClose();
    };

    const handleReset = () => {
        setValue(defaultConfig.systemInstruction);
        setIsCustom(false);
    };

    const handleRefine = async () => {
        if (!value.trim()) return;
        setIsRefining(true);

        const refinementPrompt = `
You are an expert Prompt Engineer and AI Systems Architect.
Your task is to rewrite the following basic instruction into a highly effective, professional System Prompt for an LLM (Large Language Model).

ORIGINAL INSTRUCTION:
"${value}"

GOAL:
Expand this into a robust system instruction that:
1. Defines a clear Persona/Role.
2. Sets specific constraints and guidelines.
3. Specifies the desired output format/tone.
4. Uses professional prompt engineering techniques (chain-of-thought, delimiting, etc.).
5. RETAINS the core intent of the original instruction but makes it much more effective.

OUTPUT:
Return ONLY the rewritten system prompt. Do not include any conversational filler like "Here is the refined prompt". Just the prompt text itself.
        `;

        try {
            // 1. Try Gemini
            const response = await callGeminiAgent(
                GeminiCapability.REASONING,
                "You are an expert Prompt Engineer.",
                refinementPrompt,
                [],
                true // Activate thinking for better quality
            );
            setValue(response.text);
            setIsCustom(true);
        } catch (geminiError) {
            console.warn("Gemini refinement failed, falling back to Groq", geminiError);
            try {
                // 2. Fallback to Groq
                const response = await callGroqAgent(
                    "llama-3.3-70b-versatile",
                    "You are an expert Prompt Engineer.",
                    refinementPrompt,
                    [],
                    true
                );
                setValue(response.text);
                setIsCustom(true);
            } catch (groqError) {
                console.error("All refinement attempts failed", groqError);
                // Ideally show a toast here, but for now just logging
            }
        } finally {
            setIsRefining(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center border border-indigo-500/30">
                            <i className="fas fa-robot text-indigo-400"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">System Instructions</h2>
                            <p className="text-xs text-slate-400">Customize AI behavior for <span className="text-indigo-400 font-mono">{defaultConfig.label}</span> stage</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-hidden flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="text-xs uppercase tracking-wider font-bold text-slate-500">
                                <span>Prompt Configuration</span>
                                {isCustom ? (
                                    <span className="text-amber-400 flex items-center gap-1 ml-2">
                                        <i className="fas fa-pen"></i> Modified
                                    </span>
                                ) : (
                                    <span className="text-emerald-400 flex items-center gap-1 ml-2">
                                        <i className="fas fa-check-circle"></i> Default
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Magic Polish Button */}
                        <button
                            onClick={handleRefine}
                            disabled={isRefining || !value.trim()}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all
                                ${isRefining
                                    ? 'bg-indigo-600/50 text-white cursor-wait'
                                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/20'
                                }
                            `}
                        >
                            {isRefining ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i> Refining...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-wand-magic-sparkles"></i> Magic Polish
                                </>
                            )}
                        </button>
                    </div>

                    <div className="relative flex-1 group">
                        <textarea
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setIsCustom(e.target.value.trim() !== defaultConfig.systemInstruction.trim());
                            }}
                            className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all custom-scrollbar"
                            placeholder="Enter system instructions or a simple goal like 'Focus on financial metrics'..."
                        />
                        {/* Helper Hint */}
                        <div className="absolute bottom-4 right-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] text-slate-500 bg-slate-900/80 px-2 py-1 rounded backdrop-blur-sm border border-slate-700">Type a goal & click Magic Polish ✨</span>
                        </div>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3 flex gap-3 text-xs text-blue-200 items-start">
                        <i className="fas fa-info-circle mt-0.5 shrink-0"></i>
                        <p>
                            Instructions define the "Persona" of the AI. You can make it more critical, more creative, or force specific output formats.
                            Use the <b>Magic Polish</b> button to turn simple ideas into professional prompts.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700 bg-slate-800/50 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors uppercase tracking-wider"
                    >
                        Reset to Default
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all text-xs font-bold uppercase tracking-wider"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                    >
                        <i className="fas fa-save"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};
