
import React, { useEffect, useRef, useState, useMemo } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';
import { parseEpicsFromMarkdown, EpicRow } from '../services/excelService';

interface EstimationSheetProps {
    initialMarkdown: string;
    onSave?: (data: any) => void;
    onClose?: () => void;
    className?: string;
    projectCapacity?: number; // Optional: Default capacity for summary
}

export const EstimationSheet: React.FC<EstimationSheetProps> = ({
    initialMarkdown,
    onSave,
    onClose,
    className,
}) => {
    // Tabs: 
    // 1. estimations (Main)
    // 2. planning (Planning & Capacity) - WAS summary, moved to 2nd pos
    // 3. multipliers (Reference) - WAS 2nd pos
    const [activeTab, setActiveTab] = useState<'estimations' | 'planning' | 'multipliers'>('estimations');

    // Sheet Refs
    const sheetRef = useRef<HTMLDivElement>(null);
    const planningRef = useRef<HTMLDivElement>(null);

    // Instance Refs
    const sheetInstance = useRef<any>(null);
    const planningInstance = useRef<any>(null);

    // Data State
    const [parsedData, setParsedData] = useState<EpicRow[]>([]);

    // Shared State for Calculations
    const [totalEstimationDays, setTotalEstimationDays] = useState(0);

    useEffect(() => {
        if (initialMarkdown) {
            const data = parseEpicsFromMarkdown(initialMarkdown);
            setParsedData(data);
        }
    }, [initialMarkdown]);

    // --- TAB 3: Multipliers & Scales (Static Reference) ---
    const multiplierData = [
        { level: 1, label: 'Scope is purely speculative', multiplier: 1.5 },
        { level: 2, label: 'Scope is vague', multiplier: 1.4 },
        { level: 3, label: 'Scope definition is moderate', multiplier: 1.3 },
        { level: 4, label: 'Scope could use more detail', multiplier: 1.2 },
        { level: 5, label: 'High confidence in scope definition', multiplier: 1.1 },
        { level: 6, label: 'No uncertainty to apply', multiplier: 1.0 },
    ];

    const spScaleData = [
        { sp: 1, range: '0.5 - 1 day' },
        { sp: 2, range: '1 - 2 days' },
        { sp: 3, range: '2 - 3 days' },
        { sp: 5, range: '4 - 7 days' },
        { sp: 8, range: '8 - 10 days' },
        { sp: 13, range: '12 - 16 days' },
    ];

    // --- TAB 1: Main Estimation Sheet ---
    useEffect(() => {
        if (sheetRef.current && !sheetInstance.current) {
            if (!sheetRef.current.innerHTML) {

                let data = parsedData.map(row => [
                    row.Epic,
                    row['Jira #'],
                    row['User Story Description'],
                    0, // Calculation Engine (Placeholder)
                    0, // Node
                    0, // React
                    0, // Python
                    '=E#+F#+G#', // Est (Sum) - Using # for current row
                    5, // Confidence Default
                    0, // Low Est (Placeholder logic)
                    '=H# * (IF(I#=1, 1.5, IF(I#=2, 1.4, IF(I#=3, 1.3, IF(I#=4, 1.2, IF(I#=5, 1.1, 1))))))', // High Est
                    // SP Logic:
                    `=IF(K#<=1, 1, IF(K#<=2, 2, IF(K#<=3, 3, IF(K#<=7, 5, IF(K#<=10, 8, 13)))))`
                ]);

                // Fallback for empty data to ensure sheet initializes
                if (data.length === 0) {
                    data = [[
                        '', '', '', 0, 0, 0, 0, '=E1+F1+G1', 5, 0, '=H1 * (IF(I1=1, 1.5, IF(I1=2, 1.4, IF(I1=3, 1.3, IF(I1=4, 1.2, IF(I1=5, 1.1, 1))))))', '=IF(K1<=1, 1, IF(K1<=2, 2, IF(K1<=3, 3, IF(K1<=7, 5, IF(K1<=10, 8, 13)))))'
                    ]];
                }

                const options = {
                    data: data,
                    columns: [
                        { type: 'text', title: 'Epic', width: 200 },
                        { type: 'text', title: 'Jira #', width: 80 },
                        { type: 'text', title: 'User Story Description', width: 400, wordWrap: true },
                        { type: 'numeric', title: 'Calc Engine', width: 80, readOnly: true },
                        { type: 'numeric', title: 'Node (D)', width: 70 },
                        { type: 'numeric', title: 'React (D)', width: 70 },
                        { type: 'numeric', title: 'Python (D)', width: 70 },
                        { type: 'numeric', title: 'Est (Sum)', width: 80, readOnly: true },
                        { type: 'dropdown', title: 'Conf', width: 60, source: [1, 2, 3, 4, 5, 6] },
                        { type: 'numeric', title: 'Low Est', width: 80 },
                        { type: 'numeric', title: 'High Est', width: 80, readOnly: true },
                        { type: 'numeric', title: 'SP', width: 50, readOnly: true },
                    ],
                    minDimensions: [12, 10], // Rows, Cols
                    allowComments: true,
                    tableOverflow: true,
                    tableHeight: '600px',
                    toolbar: [
                        { type: 'i', content: 'undo', onclick: () => sheetInstance.current.undo() },
                        { type: 'i', content: 'redo', onclick: () => sheetInstance.current.redo() },
                        { type: 'i', content: 'save', onclick: () => handleExport() }, // reuse export for save icon visual
                    ],
                    onchange: (instance: any, cell: any, x: any, y: any, value: any) => {
                        // Update Calculations
                        recalculateTotalDays();
                        if (onSave) {
                            // Logic to save data
                        }
                    }
                };

                const rootConfig = {
                    worksheets: [options]
                };

                sheetInstance.current = jspreadsheet(sheetRef.current, rootConfig as any);
                recalculateTotalDays(); // Initial calc
            }
        }
    }, [parsedData, activeTab]); // Re-check on tab switch to ensure rendering if not already done

    const recalculateTotalDays = () => {
        // Guard: Check if instance exists and handle array/object return types
        const instance = Array.isArray(sheetInstance.current) ? sheetInstance.current[0] : sheetInstance.current;

        if (instance && typeof instance.getData === 'function') {
            // Column K is 'High Est' (index 10)
            const colData = instance.getColumnData(10);
            let sum = colData.reduce((acc: number, val: any) => acc + (parseFloat(val) || 0), 0);
            setTotalEstimationDays(sum);

            // If planning sheet exists, update its "Total Days" cell
            if (planningInstance.current) {
                planningInstance.current.setValue('B9', sum); // Example cell
            }
        }
    };

    // --- TAB 2: Planning & Capacity ---
    useEffect(() => {
        if (activeTab === 'planning' && planningRef.current && !planningInstance.current) {
            const planningData = [
                ['Technical Architect', '25%', '=B1*1'], // 1 FTE basis
                ['Team Lead', '100%', '=B2*1'],
                ['Senior Developer', '100%', '=B3*1'],
                ['Junior Developer', '100%', '=B4*1'],
                ['QA Engineer', '100%', '=B5*1'],
                ['', '', ''], // Spacer
                ['TOTAL TEAM CAPACITY', '', '=SUM(C1:C5)'],
                ['', '', ''], // Spacer
                ['ESTIMATION SUMMARY', '', ''],
                ['Total Estimated Days', totalEstimationDays, ''], // Injected Value
                ['Weeks Required', '', '=B10 / (C7 * 5)'], // Assuming 5 work days
                ['Total Sprints', '', '=C11 / 2'], // 2 weeks per sprint
            ];

            const options = {
                data: planningData,
                columns: [
                    { type: 'text', title: 'Roles', width: 300 },
                    { type: 'text', title: 'Availability', width: 100 },
                    { type: 'numeric', title: 'Dev Capacity (FTE)', width: 150, readOnly: true }, // Logic: Input % -> Calc FTE
                ],
                mergeCells: {
                    'A7': [2, 1], // Merge "Total Team Capacity" across A, B
                    'A9': [3, 1], // Title
                },
                style: {
                    'A7': 'font-weight:bold; background-color: #f3f4f6;',
                    'C7': 'font-weight:bold; background-color: #f3f4f6;',
                    'A9': 'font-weight:bold; font-size: 14px; background-color: #e2e8f0; text-align:center;',
                    'A10': 'font-weight:bold;',
                    'A11': 'font-weight:bold;',
                    'A12': 'font-weight:bold;',
                    'B10': 'font-weight:bold; color: #4f46e5;',
                    'C11': 'font-weight:bold; color: #059669;',
                    'C12': 'font-weight:bold; color: #d97706;',
                },
                minDimensions: [5, 15],
                allowInsertRow: true,
                allowDeleteRow: true,
                onchange: (instance: any, cell: any, x: any, y: any, value: any) => {
                    // Auto-save logic if needed
                }
            };

            const planningRootConfig = {
                worksheets: [options]
            };

            planningInstance.current = jspreadsheet(planningRef.current, planningRootConfig as any);
        } else if (activeTab === 'planning' && planningInstance.current) {
            // Update the Total Days value if it changed while looking at Tab 1
            planningInstance.current.setValue('B10', totalEstimationDays);
        }
    }, [activeTab, totalEstimationDays]);


    const handleExport = () => {
        const instance = Array.isArray(sheetInstance.current) ? sheetInstance.current[0] : sheetInstance.current;
        if (instance && typeof instance.download === 'function') {
            instance.download();
        }
    };

    const handleSync = () => {
        if (confirm("This will overwrite current estimates with fresh parsing from AI output. Continue?")) {
            const data = parseEpicsFromMarkdown(initialMarkdown);
            setParsedData(data);
            const instance = Array.isArray(sheetInstance.current) ? sheetInstance.current[0] : sheetInstance.current;
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
                sheetInstance.current = null;
            }
            if (sheetRef.current) sheetRef.current.innerHTML = '';
        }
    };

    return (
        <div className={`flex flex-col h-full bg-slate-50 text-slate-900 rounded-xl overflow-hidden shadow-2xl ${className || ''}`}>
            {/* Header / Tabs */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#2c3e50] border-b border-slate-700">
                <div className="flex items-center gap-4">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors border-r border-slate-600 pr-4"
                        >
                            <i className="fas fa-chevron-left text-xs"></i>
                            <span className="text-xs font-bold uppercase tracking-widest">Back</span>
                        </button>
                    )}
                    <div className="flex gap-2">
                        {[
                            { id: 'estimations', label: '1. Estimation Main' },
                            { id: 'planning', label: '2. Planning & Capacity' }, // Swapped
                            { id: 'multipliers', label: '3. Multipliers & Scales' } // Swapped
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors
                                    ${activeTab === tab.id
                                        ? 'bg-slate-50 text-[#2c3e50]'
                                        : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 hover:text-white'}
                                `}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSync}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded transition-colors flex items-center gap-2"
                    >
                        <i className="fas fa-sync"></i> Sync AI
                    </button>
                    <button
                        onClick={handleExport}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded transition-colors flex items-center gap-2"
                    >
                        <i className="fas fa-file-excel"></i> Export
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-visible bg-slate-50 relative">

                {/* TAB 1: ESTIMATIONS */}
                <div className={`absolute inset-0 p-4 overflow-hidden ${activeTab === 'estimations' ? 'block' : 'hidden'}`}>
                    <div ref={sheetRef} className="w-full h-full shadow-sm border border-slate-300"></div>
                </div>

                {/* TAB 2: PLANNING & CAPACITY (NEW) */}
                <div className={`absolute inset-0 p-8 overflow-y-auto ${activeTab === 'planning' ? 'block' : 'hidden'}`}>
                    <div className="bg-white p-4 shadow-lg rounded-lg border border-slate-200 inline-block min-w-max">
                        <h3 className="text-sm font-bold text-[#2c3e50] uppercase tracking-widest mb-4">Sprint Planning Workbench</h3>
                        <div ref={planningRef}></div>
                        <p className="text-[10px] text-slate-400 mt-4 italic">
                            * Edit team roles and availability. Sprint calculation assumes 2-week sprints and 5 working days/week.
                        </p>
                    </div>
                </div>

                {/* TAB 3: MULTIPLIERS */}
                <div className={`absolute inset-0 p-8 overflow-y-auto ${activeTab === 'multipliers' ? 'block' : 'hidden'}`}>
                    <div className="max-w-4xl mx-auto space-y-8">
                        <div>
                            <h3 className="text-sm font-bold text-[#2c3e50] uppercase tracking-widest mb-4 border-b pb-2">Confidence Multipliers</h3>
                            <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-200 text-slate-600 font-bold uppercase">
                                        <th className="p-3 border">Level</th>
                                        <th className="p-3 border">Description</th>
                                        <th className="p-3 border">Multiplier</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {multiplierData.map((row) => (
                                        <tr key={row.level} className="border-b bg-white">
                                            <td className="p-3 border text-center font-bold">{row.level}</td>
                                            <td className="p-3 border">{row.label}</td>
                                            <td className="p-3 border font-mono text-indigo-600">{row.multiplier}x</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-[#2c3e50] uppercase tracking-widest mb-4 border-b pb-2">Story Point Scale</h3>
                            <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-200 text-slate-600 font-bold uppercase">
                                        <th className="p-3 border">Story Points</th>
                                        <th className="p-3 border">Day Range</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {spScaleData.map((row) => (
                                        <tr key={row.sp} className="border-b bg-white">
                                            <td className="p-3 border text-center font-bold text-emerald-600">{row.sp}</td>
                                            <td className="p-3 border">{row.range}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
