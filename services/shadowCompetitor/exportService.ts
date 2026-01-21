// Export service for Shadow Competitor results

export function exportToCSV(dna: any[], warGaming: any[]): void {
    const csvRows = [
        ['Competitor', 'Cash (M)', 'R&D (M)', 'Classification', 'Risk Appetite'].join(','),
        ...dna.map(d => [
            d.name,
            d.financialFlexibility.cashOnHand,
            d.financialFlexibility.rdSpend,
            d.financialFlexibility.classification,
            d.riskAppetite
        ].join(','))
    ];

    const csvContent = csvRows.join('\n');
    downloadFile(csvContent, `shadow-competitor-${Date.now()}.csv`, 'text/csv');
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
