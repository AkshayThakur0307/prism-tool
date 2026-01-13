import React from 'react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean; // If true, button is red. Else, maybe blue/primary.
    isLoading?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    isDestructive = false,
    isLoading = false
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className={`text-lg font-bold flex items-center gap-2 mb-2 ${isDestructive ? 'text-white' : 'text-white'}`}>
                        {isDestructive ? (
                            <i className="fas fa-exclamation-triangle text-amber-500"></i>
                        ) : (
                            <i className="fas fa-info-circle text-indigo-500"></i>
                        )}
                        {title}
                    </h3>
                    <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                        {message}
                    </p>

                    <div className="flex gap-3 justify-end">
                        {cancelLabel && (
                            <button
                                onClick={onClose}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-50"
                            >
                                {cancelLabel}
                            </button>
                        )}
                        <button
                            onClick={onConfirm}
                            disabled={isLoading}
                            className={`px-4 py-2 rounded-lg text-sm font-bold text-white shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
                                ${isDestructive
                                    ? 'bg-red-600 hover:bg-red-500 shadow-red-600/20'
                                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/20'
                                }`}
                        >
                            {isLoading && <i className="fas fa-circle-notch fa-spin text-xs"></i>}
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
