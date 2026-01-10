import React, { useState } from 'react';

interface VoiceInputTriggerProps {
    onStart: () => void;
    isListening: boolean;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const VoiceInputTrigger: React.FC<VoiceInputTriggerProps> = ({
    onStart,
    isListening,
    className = '',
    size = 'md'
}) => {
    const sizeClasses = {
        sm: 'w-6 h-6 text-[10px]',
        md: 'w-8 h-8 text-xs',
        lg: 'w-10 h-10 text-sm'
    };

    return (
        <button
            onClick={onStart}
            disabled={isListening}
            className={`
        rounded-full flex items-center justify-center transition-all duration-300
        ${isListening
                    ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)] scale-110 animate-pulse cursor-not-allowed'
                    : 'bg-slate-800 text-slate-400 hover:bg-indigo-600 hover:text-white hover:shadow-lg hover:shadow-indigo-500/20 hover:scale-105'
                }
        ${sizeClasses[size]}
        ${className}
      `}
            title={isListening ? "Listening..." : "Use Voice Input"}
        >
            <i className={`fas ${isListening ? 'fa-microphone-lines' : 'fa-microphone'}`}></i>
        </button>
    );
};
