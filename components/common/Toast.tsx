import React, { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
    message: string;
    type?: ToastType;
    onClose: () => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const styles = {
        success: 'bg-emerald-500 text-white shadow-emerald-500/30',
        error: 'bg-rose-500 text-white shadow-rose-500/30',
        info: 'bg-blue-500 text-white shadow-blue-500/30',
    };

    const icons = {
        success: 'fa-check',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
    };

    return (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 z-[200] ${styles[type]}`}>
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                <i className={`fas ${icons[type]} text-xs`}></i>
            </div>
            <span className="font-bold text-sm tracking-wide">{message}</span>
            <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100 transition-opacity">
                <i className="fas fa-times text-xs"></i>
            </button>
        </div>
    );
};

export default Toast;
