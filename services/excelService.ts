
import * as XLSX from 'xlsx';

export interface EpicRow {
    Epic: string;
    'Jira #': string;
    'User Story Description': string;
    'Calculation Engine\n(Days)': number;
    'Node\n(Days)': number;
    'React\n(Days)': number;
    'Python\n(Days)': number;
    'Est\n(Days)': number;
    Confidence: number;
    'Low Est\n(Days)': number;
    'High Est\n(Days)': number;
    SP: string;
    'Srijan Assumption & Approach': string;
}

export const parseEpicsFromMarkdown = (markdown: string): EpicRow[] => {
    // We expect headers like "## Epic: Name" and "### Story: Name" or "### User Story: Name"
    // and body text for the description.

    let rows: EpicRow[] = [];
    if (!markdown || typeof markdown !== 'string') return rows;
    const lines = markdown.split('\n');

    // Helper to clean titles
    const cleanTitle = (text: string) => text.replace(/^[#*_\s]+/, '').replace(/[*_\s]+$/, '').trim();

    // Strategy 1: Strict Parsing (Look for "Epic" and "Story" keywords)
    const tryParseStrict = (): EpicRow[] => {
        const _rows: EpicRow[] = [];
        let currentEpic = '';
        let currentStoryTitle = '';
        let currentStoryBody = '';

        const commitStory = () => {
            if ((currentStoryTitle || currentStoryBody) && currentEpic) {
                const fullDescription = `${currentStoryTitle}\n\n${currentStoryBody.trim()}`;
                _rows.push({
                    Epic: currentEpic,
                    'Jira #': '',
                    'User Story Description': fullDescription.trim(),
                    'Calculation Engine\n(Days)': 0,
                    'Node\n(Days)': 0,
                    'React\n(Days)': 0,
                    'Python\n(Days)': 0,
                    'Est\n(Days)': 0,
                    Confidence: 5,
                    'Low Est\n(Days)': 0,
                    'High Est\n(Days)': 0,
                    SP: '',
                    'Srijan Assumption & Approach': ''
                });
            }
            currentStoryTitle = '';
            currentStoryBody = '';
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            const isEpic = /^(##|###|\*\*|__)?\s*Epic/i.test(trimmed);
            const isStory = /^(###|####|\*\*|__)?\s*(User\s*)?Story/i.test(trimmed);

            if (isEpic) {
                commitStory();
                currentEpic = trimmed.replace(/^([#*_\s]*)(Epic\s*\d*[\s:-]*)/i, '').trim();
            } else if (isStory) {
                commitStory();
                currentStoryTitle = trimmed.replace(/^([#*_\s]*)(User\s*)?Story\s*\d*[\s:-]*/i, '').trim();
            } else if (currentEpic && currentStoryTitle) {
                currentStoryBody += line + '\n';
            }
        });
        commitStory();
        return _rows;
    };

    // Strategy 2: Header-based Fallback (## for Epic, ### for Story)
    const tryParseHeaders = (): EpicRow[] => {
        const _rows: EpicRow[] = [];
        let currentEpic = '';
        let currentStoryTitle = '';
        let currentStoryBody = '';

        const commitStory = () => {
            if (currentEpic) {
                if (currentStoryTitle || currentStoryBody) {
                    const title = currentStoryTitle || 'User Story';
                    const desc = currentStoryBody.trim();
                    if (desc) {
                        const fullDescription = `${title}\n\n${desc}`;
                        _rows.push({
                            Epic: currentEpic,
                            'Jira #': '',
                            'User Story Description': fullDescription.trim(),
                            'Calculation Engine\n(Days)': 0,
                            'Node\n(Days)': 0,
                            'React\n(Days)': 0,
                            'Python\n(Days)': 0,
                            'Est\n(Days)': 0,
                            Confidence: 5,
                            'Low Est\n(Days)': 0,
                            'High Est\n(Days)': 0,
                            SP: '',
                            'Srijan Assumption & Approach': ''
                        });
                    }
                }
            }
            currentStoryTitle = '';
            currentStoryBody = '';
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            // Ignore questions/clarifications sections
            if (/Clarification|Question|Conclusion/i.test(trimmed) && /^#/.test(trimmed)) {
                currentEpic = '';
                return;
            }

            const isH2 = /^(##|#)\s+/.test(trimmed) && !/Epic/i.test(trimmed); // Capture ## or # as Epic
            const isH3 = /^(###|####)\s+/.test(trimmed);
            const isBold = /^\*\*.+\*\*$/.test(trimmed); // Catch bold headers

            if (isH2) {
                commitStory();
                currentEpic = cleanTitle(trimmed);
            } else if ((isH3 || isBold) && currentEpic) {
                commitStory();
                currentStoryTitle = cleanTitle(trimmed);
            } else if (isBold && !currentEpic) {
                // If we see a bold header and have no Epic yet, treat it as an Epic
                commitStory();
                currentEpic = cleanTitle(trimmed);
            } else if (currentEpic) {
                currentStoryBody += line + '\n';
            }
        });
        commitStory();
        return _rows;
    };

    // Execute Strategies
    rows = tryParseStrict();
    if (rows.length === 0) {
        console.log('Strict parsing returned 0 rows. Using fallback header strategy.');
        rows = tryParseHeaders();
    }

    return rows;
};

export const generateEpicsExcel = (markdown: string, filename: string = 'Epics_Estimation_Sheet.xlsx') => {
    const rows = parseEpicsFromMarkdown(markdown);

    if (rows.length === 0) {
        alert("No Epics or Stories found to export. Please ensure the output contains '## Epic' and '### Story' sections.");
        return;
    }

    // 2. Create Workbook
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // 3. Style Columns (Widths)
    const colWidths = [
        { wch: 40 }, // Epic
        { wch: 10 }, // Jira #
        { wch: 80 }, // Description
        { wch: 15 }, // Calc
        { wch: 10 }, // Node
        { wch: 10 }, // React
        { wch: 10 }, // Python
        { wch: 10 }, // Est
        { wch: 10 }, // Conf
        { wch: 10 }, // Low
        { wch: 10 }, // High
        { wch: 5 },  // SP
        { wch: 40 }  // Assumptions
    ];
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Estimates');

    // 4. Download
    XLSX.writeFile(workbook, filename);
};
