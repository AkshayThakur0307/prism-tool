
import * as XLSX from 'xlsx';

interface EpicRow {
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

export const generateEpicsExcel = (markdown: string, filename: string = 'Epics_Estimation_Sheet.xlsx') => {
    // 1. Parse Markdown
    // We expect headers like "## Epic: Name" and "### Story: Name" or "### User Story: Name"
    // and body text for the description.

    const rows: EpicRow[] = [];
    const lines = markdown.split('\n');

    let currentEpic = '';
    let currentStoryTitle = '';
    let currentStoryBody = '';

    // Helper to commit the last story
    const commitStory = () => {
        if ((currentStoryTitle || currentStoryBody) && currentEpic) {
            const fullDescription = `${currentStoryTitle}\n\n${currentStoryBody.trim()}`;
            rows.push({
                Epic: currentEpic,
                'Jira #': '',
                'User Story Description': fullDescription.trim(),
                'Calculation Engine\n(Days)': 0,
                'Node\n(Days)': 0,
                'React\n(Days)': 0,
                'Python\n(Days)': 0,
                'Est\n(Days)': 0, // This would ideally be a formula in real excel, but here we set 0
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

        // Detect Epic (## Epic, **Epic**, or just Epic at start of line)
        const isEpic = /^(##|###|\*\*|__)?\s*Epic/i.test(trimmed);

        // Detect Story (### Story, **Story**, **User Story**, or just Story/User Story)
        const isStory = /^(###|####|\*\*|__)?\s*(User\s*)?Story/i.test(trimmed);

        if (isEpic) {
            commitStory(); // Commit previous story if any
            // Extract Epic Name (remove "## Epic X:" prefix)
            currentEpic = trimmed.replace(/^([#*_\s]*)(Epic\s*\d*[\s:-]*)/i, '').trim();
        }
        // Detect Story
        else if (isStory) {
            commitStory(); // Commit previous story belonging to current epic
            // Extract Story Title
            currentStoryTitle = trimmed.replace(/^([#*_\s]*)(User\s*)?Story\s*\d*[\s:-]*/i, '').trim();
        }
        // Detect Content (Description / AC)
        else {
            // Collect description lines only if we are inside a story
            if (currentEpic && currentStoryTitle) {
                // Filter out generic headers like "Acceptance Criteria" to keep it cleaner? 
                // Or keep everything. User said "Story description refers to title & brief summary".
                // We will append line to body
                currentStoryBody += line + '\n';
            }
        }
    });

    // Commit the final story
    commitStory();

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
