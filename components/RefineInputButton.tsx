
import React, { useState } from 'react';
import { refineInputText } from '../services/geminiService';

interface RefineInputButtonProps {
    text: string;
    onRefine: (refinedText: string) => void;
    contextType?: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const RefineInputButton: React.FC<RefineInputButtonProps> = ({
    text,
    onRefine,
    contextType = 'general',
    className = '',
    size = 'md'
}) => {
    const [isRefining, setIsRefining] = useState(false);

    const handleRefine = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!text || !text.trim()) return;

        setIsRefining(true);
        try {
            const refined = await refineInputText(text, contextType);
            if (refined && refined !== text) {
                onRefine(refined);
            }
        } catch (err) {
            console.error("Refinment button failed:", err);
        } finally {
            setIsRefining(false);
        }
    };

    const sizeClasses = {
        sm: 'w-6 h-6 text-[10px]',
        md: 'w-8 h-8 text-xs',
        lg: 'w-10 h-10 text-sm'
    };

    return (
        <button
            onClick={handleRefine}
            disabled={isRefining || !text.trim()}
            className={`
        rounded-full flex items-center justify-center transition-all duration-300 relative group
        ${isRefining
                    ? 'bg-indigo-600/20 text-indigo-400 cursor-wait'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500 hover:scale-105 hover:shadow-lg hover:shadow-indigo-500/30'
                }
        ${sizeClasses[size]}
        ${className}
      `}
            title="Magic Refine: Polish grammar, structure and clarity"
        >
            {isRefining ? (
                <div className="w-3/4 h-3/4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin"></div>
            ) : (
                <>
                    <i className="fas fa-wand-magic-sparkles"></i>
                    <div className="absolute inset-0 rounded-full bg-white/20 animate-ping opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
                </>
            )}
        </button>
    );
};
