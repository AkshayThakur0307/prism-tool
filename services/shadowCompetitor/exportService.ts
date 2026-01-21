// Export service for Shadow Competitor results

export function exportToCSV(dna: any[], warGaming: any[], comparisons: any[] = []): void {
    const sections = [];

    // DNA Section
    const dnaHeaders = ['Competitor', 'Cash (M)', 'R&D (M)', 'Classification', 'Risk Appetite'];
    const dnaRows = dna.map(d => [
        d.name,
        d.financialFlexibility?.cashOnHand || 'N/A',
        d.financialFlexibility?.rdSpend || 'N/A',
        d.financialFlexibility?.classification || 'N/A',
        d.riskAppetite
    ]);
    sections.push(['COMPETITOR DNA PROFILE']);
    sections.push(dnaHeaders);
    sections.push(...dnaRows);
    sections.push([]); // Empty line separator

    // Comparisons Section
    if (comparisons.length > 0) {
        sections.push(['STRATEGIC BENCHMARKING (HEAD-TO-HEAD)']);
        const compHeaders = ['Competitor', 'Category', 'User Score', 'Comp Score', 'Winner', 'Rationale'];
        comparisons.forEach(c => {
            c.benchmarks.forEach((b: any) => {
                sections.push([
                    c.competitor,
                    b.category,
                    b.userScore,
                    b.competitorScore,
                    b.winner,
                    `"${b.rationale.replace(/"/g, '""')}"`
                ]);
            });
        });
        sections.push([]);
    }

    // War Gaming Section
    if (warGaming.length > 0) {
        sections.push(['WAR-GAMING SIMULATIONS']);
        const warHeaders = ['Competitor', 'Prob', 'Counter Move', 'T30', 'T90', 'T180'];
        sections.push(warHeaders);
        warGaming.forEach(w => {
            sections.push([
                w.competitor,
                w.probability,
                `"${(w.competitorCounterMove || w.likelyMove).replace(/"/g, '""')}"`,
                `"${(w.timeline?.T30 || '').replace(/"/g, '""')}"`,
                `"${(w.timeline?.T90 || '').replace(/"/g, '""')}"`,
                `"${(w.timeline?.T180 || '').replace(/"/g, '""')}"`
            ]);
        });
    }

    const csvContent = sections.map(row => row.join(',')).join('\n');
    downloadFile(csvContent, `shadow-competitor-analysis-${Date.now()}.csv`, 'text/csv');
}

export function exportToJSON(data: any): void {
    const jsonContent = JSON.stringify(data, null, 2);
    downloadFile(jsonContent, `shadow-competitor-${Date.now()}.json`, 'application/json');
}


export function exportToPDF(): void {
    alert('PDF export requires additional library. Use Print to PDF for now.');
    window.print();
}

function downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
