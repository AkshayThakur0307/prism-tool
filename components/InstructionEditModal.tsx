import React, { useState, useEffect } from 'react';
import { DiscoveryStage } from '../types';
import { STAGE_CONFIGS } from '../constants';

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
                    <div className="flex items-center justify-between text-xs uppercase tracking-wider font-bold text-slate-500">
                        <span>Prompt Configuration</span>
                        {isCustom ? (
                            <span className="text-amber-400 flex items-center gap-1">
                                <i className="fas fa-pen"></i> Modified
                            </span>
                        ) : (
                            <span className="text-emerald-400 flex items-center gap-1">
                                <i className="fas fa-check-circle"></i> Default
                            </span>
                        )}
                    </div>

                    <div className="relative flex-1">
                        <textarea
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setIsCustom(e.target.value.trim() !== defaultConfig.systemInstruction.trim());
                            }}
                            className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all custom-scrollbar"
                            placeholder="Enter system instructions..."
                        />
                    </div>

                    <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3 flex gap-3 text-xs text-blue-200 items-start">
                        <i className="fas fa-info-circle mt-0.5 shrink-0"></i>
                        <p>Modifying instructions affects output structure and style. Ensure you retain critical output format rules (e.g. JSON structures or specific headers) to prevent parsing errors.</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700 bg-slate-800/50 rounded-b-xl flex justify-between items-center">
                    <button
                        onClick={handleReset}
                        disabled={!isCustom}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isCustom
                                ? 'text-red-400 hover:bg-slate-700 hover:text-red-300'
                                : 'text-slate-600 cursor-not-allowed opacity-50'
                            }`}
                    >
                        <i className="fas fa-undo"></i>
                        Reset to Default
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-sm font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-lg shadow-indigo-600/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] font-semibold text-sm"
                        >
                            <i className="fas fa-save"></i>
                            Save Capabilities
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
