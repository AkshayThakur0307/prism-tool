import React, { useState } from 'react';

interface SessionSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    summaryMarkdown: string;
    onApplyToBacklog: () => void;
    onDiscard: () => void;
}

export const SessionSummaryModal: React.FC<SessionSummaryModalProps> = ({
    isOpen, onClose, summaryMarkdown, onApplyToBacklog, onDiscard
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="w-full max-w-3xl max-h-[80vh] bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="h-16 px-8 border-b border-slate-700/50 flex items-center justify-between bg-slate-950/50">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                            <i className="fas fa-file-signature text-indigo-400"></i>
                        </div>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">Session Synthesis</h2>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-900">
                    <div className="prose prose-invert prose-sm max-w-none">
                        {/* We render simple markdown here. For a real app, use a markdown renderer. 
                            For MVP, we trust the LLM structure or do basic replacement. */}
                        <div className="whitespace-pre-wrap font-sans text-slate-300 leading-relaxed">
                            <div id="summary-content" className="whitespace-pre-wrap font-sans text-slate-300 leading-relaxed">
                                {summaryMarkdown}
                            </div>
                        </div>
                    </div>

                </div>

                {/* Actions */}
                <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900/50">
                    <button
                        onClick={onDiscard}
                        className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-xs font-bold uppercase tracking-wider"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => {
                            // Export Transcript as TXT
                            const blob = new Blob([summaryMarkdown], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `WarRoom_Transcript_${new Date().toISOString().slice(0, 10)}.txt`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }}
                        className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-500 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                    >
                        <i className="fas fa-file-alt"></i> Export TXT
                    </button>
                    <button
                        onClick={() => {
                            // Export as Word Doc (HTML trick)
                            const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>War Room Summary</title></head><body>";
                            const footer = "</body></html>";
                            const sourceHTML = header + document.getElementById('summary-content')?.innerHTML + footer;

                            const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `WarRoom_Summary_${new Date().toISOString().slice(0, 10)}.doc`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        }}
                        className="px-4 py-2 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/30 hover:bg-blue-600/20 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                    >
                        <i className="fas fa-file-word"></i> Export Doc
                    </button>
                    <button
                        onClick={() => {
                            // Print to PDF
                            const printWindow = window.open('', '', 'height=600,width=800');
                            if (printWindow) {
                                printWindow.document.write('<html><head><title>War Room Report</title>');
                                printWindow.document.write('<style>body { font-family: sans-serif; padding: 40px; } h1 { color: #333; } p { line-height: 1.6; color: #555; } .prose { max-width: 100%; }</style>');
                                printWindow.document.write('</head><body>');
                                printWindow.document.write(document.getElementById('summary-content')?.innerHTML || '');
                                printWindow.document.write('</body></html>');
                                printWindow.document.close();
                                printWindow.print();
                            }
                        }}
                        className="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2"
                    >
                        <i className="fas fa-file-pdf"></i> Export PDF
                    </button>
                </div>
            </div>
        </div>
    );
};
