// Main orchestrator service for Shadow Competitor Analysis

import { callGeminiAgent, GeminiAgentResponse } from '../geminiService';
import { GeminiCapability } from '../modelConfig';
import { searchGoogle } from '../searchService';
import { Region, RegulatoryBody } from './geographyDetector';

export interface CompetitorInput {
    name: string;
    region: Region;
    regulatoryBody: RegulatoryBody;
}

export interface ProgressCallback {
    (phase: number, competitor: string, status: string, progress: number): void;
}

export interface CompetitorDNA {
    name: string;
    financialFlexibility: {
        cashOnHand: string | number;
        rdSpend: string | number;
        classification: 'Asset-Light' | 'Capital-Heavy';
    };
    strategicCommitment: string[];
    technicalMoats: string[];
    riskAppetite: 'High' | 'Medium' | 'Low';
    citations: string[];
    confidence?: {
        level: 'High' | 'Medium' | 'Low';
        reason: string;
    };
}

export interface WarGameResponse {
    competitor: string;
    userMove: string;
    competitorCounterMove: string;
    likelyMove: string;
    probability: 'High' | 'Medium' | 'Low';
    impactOnROI: string;
    timeline: {
        T30: string;
        T90: string;
        T180: string;
        T365: string;
    };
    copyableFeatures: string[];
    uncopyableFeatures: string[];
}

export interface MoatValidation {
    greenFlags: Array<{ feature: string; rationale: string; leadTime: string }>;
    redFlags: Array<{ feature: string; rationale: string; copyTime: string }>;
    strategicPivot: string;
}

export interface Citation {
    competitor: string;
    filingType: string;
    section: string;
    url: string;
}

export interface AnalysisResult {
    dna: CompetitorDNA[];
    warGaming: WarGameResponse[];
    moat: MoatValidation;
    citations: Citation[];
    recommendations: string[];
    fullReport: string;
}

class ShadowCompetitorOrchestrator {
    private isPaused = false;
    private shouldStop = false;

    async runFullAnalysis(
        competitors: CompetitorInput[],
        ourRoadmap: string,
        onProgress?: ProgressCallback
    ): Promise<AnalysisResult> {
        this.isPaused = false;
        this.shouldStop = false;

        const dnaProfiles: CompetitorDNA[] = [];
        const warGamingResults: WarGameResponse[] = [];
        const citations: Citation[] = [];

        // PHASE 1: DNA Extraction
        for (let i = 0; i < competitors.length; i++) {
            if (this.shouldStop) throw new Error('Aborted by user');
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const comp = competitors[i];
            onProgress?.(1, comp.name, `Extracting ${comp.regulatoryBody} filings...`, (i / competitors.length) * 33);

            const { text: filings, sources: realSources } = await this.extractFilings(comp);

            // Granular Abort Check
            if (this.shouldStop) throw new Error('Aborted by user');

            // Granular Pause Check
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const dna = await this.analyzeDNA(comp, filings);
            if (this.shouldStop) throw new Error('Aborted by user');
            dnaProfiles.push(dna);

            // Store REAL verified sources from the search service
            if (realSources && realSources.length > 0) {
                realSources.forEach(source => {
                    citations.push({
                        competitor: comp.name,
                        filingType: 'Verified Source',
                        section: source.title || 'Web Search Result',
                        url: source.uri
                    });
                });
            }

            // Store citations (from LLM output - often hallucinations, keeping as fallback/context)
            if (dna.citations && Array.isArray(dna.citations)) {
                dna.citations.forEach(citation => {
                    const citationText = typeof citation === 'string' ? citation : JSON.stringify(citation);
                    citations.push({
                        competitor: comp.name,
                        filingType: citationText.includes('http') ? 'Web Source' : citationText.split(',')[0],
                        section: citationText,
                        url: citationText.includes('http') && typeof citation === 'string' ? citation : this.getFilingUrl(comp)
                    });
                });
            }
        }

        // PHASE 2: War-Gaming Simulation
        for (let i = 0; i < competitors.length; i++) {
            if (this.shouldStop) throw new Error('Aborted by user');
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const comp = competitors[i];
            onProgress?.(2, comp.name, 'Simulating competitive response...', 33 + (i / competitors.length) * 33);

            const response = await this.simulateResponse(dnaProfiles[i], ourRoadmap);
            if (this.shouldStop) throw new Error('Aborted by user');
            warGamingResults.push(response);
        }

        // PHASE 3: Moat Validation
        onProgress?.(3, 'All Competitors', 'Generating moat validation...', 75);
        const moat = await this.validateMoats(warGamingResults, ourRoadmap);
        const recommendations = await this.generateRecommendations(warGamingResults, moat, ourRoadmap);

        onProgress?.(3, 'All Competitors', 'Formatting final report...', 90);
        const fullReport = this.formatReport(dnaProfiles, warGamingResults, moat, recommendations);

        onProgress?.(3, 'All Competitors', 'Complete!', 100);

        return {
            dna: dnaProfiles,
            warGaming: warGamingResults,
            moat,
            citations,
            recommendations,
            fullReport
        };
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    abort() {
        this.shouldStop = true;
        this.isPaused = false; // Unpause to allow exit loops
    }

    stop() {
        this.shouldStop = true;
    }

    private async extractFilings(competitor: CompetitorInput): Promise<{ text: string, sources: any[] }> {
        // Broaden search to include financial news and generic reports, essential for private/subsidiary companies
        const query = competitor.regulatoryBody === 'SEC'
            ? `${competitor.name} financial results 10-K 10-Q revenue profit site:sec.gov OR site:bloomberg.com OR site:reuters.com`
            : `${competitor.name} annual report financial results revenue profit valuation site:bseindia.com OR site:nseindia.com OR site:moneycontrol.com OR site:economictimes.indiatimes.com OR filetype:pdf`;

        // Calculate current and recent fiscal years dynamically
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed

        // Most companies end fiscal year in Q4, so if we're in Jan-Mar, latest FY report is from previous year
        const latestFiscalYear = currentMonth < 3 ? currentYear - 1 : currentYear;
        const priorFiscalYear = latestFiscalYear - 1;

        // For quarterly reports, calculate most recent quarter
        const currentQuarter = Math.floor(currentMonth / 3) + 1;
        const latestQuarter = currentMonth < 3 ? `Q4 ${currentYear - 1}` : `Q${currentQuarter - 1} ${currentYear}`;

        const systemPrompt = `You are a financial analyst extracting competitive intelligence for ${competitor.name}.
CRITICAL: Today is ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

DATA SOURCES:
- Primary: Regulatory filings (10-K, Annual Reports) for ${latestFiscalYear}.
- Secondary (Use if Private/Subsidiary): Reliable financial news (Bloomberg, Reuters, MoneyControl, TechCrunch) from the last 12 months.

REQUIRED DATA (Provide estimates if exact figures differ by source):
1. Financial Metrics:
   - Cash/Reserves: Look for "capital injection", "funding round", "cash burn", or "reserves".
   - R&D/Tech Spend: Often cited as % of revenue or specific investment announcements.
   - Revenue: Annual run rate (ARR) or fiscal revenue.
   - Profitability: EBITDA, Net Loss/Profit margins.
   - **NOTE**: If ${competitor.name} is a subsidiary (e.g., Apollo Pharmacies -> Apollo Hospitals), extract PARENT company data but explicitly label it as "Parent Co. Data".

2. Strategic Intelligence:
   - Key product launches or pivot announcements.
   - Expansion (geo or new verticals).
   - Tech stack investments (GenAI, specialized hardware).

3. Moats (Infer if not explicit):
   - Network effects, regulatory licenses, unique datasets, or deep pockets (parent co support).

OUTPUT: Structured summary. If data is estimated/from news, explicitly cite the source (e.g., "Source: TechCrunch 2024"). DO NOT return $0 unless specifically stated as such. Use "Unknown" or "Undisclosed" if absolutely no data found.`;

        try {
            const result = await callGeminiAgent(
                GeminiCapability.RESEARCH,
                systemPrompt,
                query,
                [],
                false,
                true
            );
            return { text: result.text || '', sources: result.sources || [] };
        } catch (error) {
            console.error(`Filing extraction failed for ${competitor.name}:`, error);
            return { text: `Limited data available for ${competitor.name}`, sources: [] };
        }
    }

    private async analyzeDNA(competitor: CompetitorInput, filings: string): Promise<CompetitorDNA> {
        const prompt = `Analyze ${competitor.name} and extract:
1. Financial Flexibility (Cash & R&D). Return strings like "Est. $50M", "Undisclosed", or "$1B+" if exact numbers unavailable.
2. Strategic Commitment (top 3-5 priorities)
3. Technical Moats
4. Risk Appetite
5. Confidence Assessment:
   - Does the data explicitly mention ${competitor.name}?
   - If data is generic/missing, set level="Low".
   - If data is specific/verified, set level="High".

Output as JSON matching this schema:
{
  "FinancialFlexibility": { "cashOnHand": "...", "rdSpend": "...", "classification": "..." },
  "StrategicCommitment": ["..."],
  "TechnicalMoats": ["..."],
  "RiskAppetite": "High/Medium/Low",
  "Confidence": { "level": "High/Medium/Low", "reason": "Text..." },
  "Citations": ["..."]
}`;

        try {
            const result = await callGeminiAgent(
                GeminiCapability.ANALYSIS_MAIN,
                prompt,
                filings,
                [],
                true,
                false
            );

            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                console.log(`[ShadowCompetitor] Raw DNA JSON for ${competitor.name}:`, jsonMatch[0]); // DEBUG LOG
                const parsed = JSON.parse(jsonMatch[0]);

                // Helper to safely get value regardless of casing or nesting (e.g. Cash.Value vs cashOnHand)
                const getVal = (obj: any, keys: string[]) => {
                    if (!obj) return null;
                    for (const key of keys) {
                        if (obj[key] !== undefined) return obj[key];
                        const lower = key.toLowerCase(); // simplified match
                        const match = Object.keys(obj).find(k => k.toLowerCase() === lower);
                        if (match) return obj[match];
                    }
                    return null;
                };

                const financial = getVal(parsed, ['FinancialFlexibility', 'financialFlexibility']) || {};
                const cashRaw = getVal(financial, ['Cash', 'cashOnHand']);
                const rdRaw = getVal(financial, ['R&D', 'rdSpend']);

                // Handle nested "Value" objects common in some LLM outputs
                const cash = typeof cashRaw === 'object' && cashRaw?.Value ? cashRaw.Value : cashRaw;
                const rd = typeof rdRaw === 'object' && rdRaw?.Value ? rdRaw.Value : rdRaw;

                return {
                    name: competitor.name,
                    financialFlexibility: {
                        cashOnHand: cash || 'Unknown',
                        rdSpend: rd || 'Unknown',
                        classification: (getVal(financial, ['classification']) || 'Capital-Heavy') as any
                    },
                    strategicCommitment: (getVal(parsed, ['StrategicCommitment', 'strategicCommitment']) || [])
                        .map((s: any) => typeof s === 'object' && s.Priority ? s.Priority : s), // Handle {Priority: "..."} objects
                    technicalMoats: (getVal(parsed, ['TechnicalMoats', 'technicalMoats']) || [])
                        .map((m: any) => typeof m === 'object' && m.Moat ? m.Moat : m), // Handle {Moat: "..."} objects
                    riskAppetite: typeof getVal(parsed, ['RiskAppetite', 'riskAppetite']) === 'object'
                        ? 'Medium' // Default if it returns an explanation object instead of string
                        : (getVal(parsed, ['RiskAppetite', 'riskAppetite']) || 'Medium') as any,
                    citations: getVal(parsed, ['citations', 'Citations', 'Source', 'Sources']) || [],
                    confidence: {
                        level: (getVal(parsed, ['Confidence', 'confidence'])?.level as any) || 'Medium',
                        reason: getVal(parsed, ['Confidence', 'confidence'])?.reason || 'Standard analysis based on available data.'
                    }
                };
            }
        } catch (error) {
            console.error(`DNA analysis failed for ${competitor.name}:`, error);
        }

        return {
            name: competitor.name,
            financialFlexibility: { cashOnHand: 0, rdSpend: 0, classification: 'Capital-Heavy' },
            strategicCommitment: ['Data unavailable'],
            technicalMoats: ['Unknown'],
            riskAppetite: 'Medium',
            citations: []
        };
    }

    private async simulateResponse(dna: CompetitorDNA, roadmap: string): Promise<WarGameResponse> {
        const prompt = `Predict ${dna.name}'s competitive response to: ${roadmap}

Based on their DNA:
- Cash: ${dna.financialFlexibility?.cashOnHand ?? 0}, R&D: ${dna.financialFlexibility?.rdSpend ?? 0}
- Strategy: ${dna.strategicCommitment?.join(', ') ?? 'Unknown'}
- Moats: ${dna.technicalMoats?.join(', ') ?? 'Unknown'}

Output STRICT JSON matching this schema:
{
  "userMove": "Brief description of the user's strategic move (deduced from roadmap)",
  "competitorCounterMove": "How ${dna.name} will specifically counter this move",
  "likelyMove": "Short summary of the counter-move title",
  "probability": "High" | "Medium" | "Low",
  "impactOnROI": "Description of impact",
  "timeline": { "T30": "Immediate action", "T90": "Quarterly action", "T180": "6-month action", "T365": "1-year outlook" },
  "copyableFeatures": ["Feature A", "Feature B"],
  "uncopyableFeatures": ["Feature C", "Feature D"]
}`;

        try {
            const result = await callGeminiAgent(
                GeminiCapability.ANALYSIS_MAIN,
                prompt,
                '',
                [],
                true,
                false
            );

            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                console.log(`[ShadowCompetitor] Raw WarGame JSON for ${dna.name}:`, jsonMatch[0]); // DEBUG LOG
                const parsed = JSON.parse(jsonMatch[0]);
                // Ensure competitor name is set correctly
                return { ...parsed, competitor: dna.name };
            }
        } catch (error) {
            console.error(`War-gaming failed for ${dna.name}:`, error);
        }

        return {
            competitor: dna.name,
            userMove: 'Unknown',
            competitorCounterMove: 'Unknown',
            likelyMove: 'Unknown',
            probability: 'Medium',
            impactOnROI: 'Unknown',
            timeline: { T30: '', T90: '', T180: '', T365: '' },
            copyableFeatures: [],
            uncopyableFeatures: []
        };
    }

    private async validateMoats(responses: WarGameResponse[], roadmap: string): Promise<MoatValidation> {
        const prompt = `Analyze competitive responses and identify:
1. Green Flags (defensible features)
2. Red Flags (copyable features)
3. Strategic Pivot recommendation

Responses: ${JSON.stringify(responses)}

Output STRICT JSON matching this schema:
{
  "greenFlags": [{ "feature": "Name", "rationale": "Why defensible", "leadTime": "e.g. 6mo" }],
  "redFlags": [{ "feature": "Name", "rationale": "Why vulnerable", "copyTime": "e.g. 2wks" }],
  "strategicPivot": "Strategic recommendation summary"
}`;

        try {
            const result = await callGeminiAgent(
                GeminiCapability.ANALYSIS_MAIN,
                prompt,
                '',
                [],
                true,
                false
            );

            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                console.log(`[ShadowCompetitor] Raw MoatValidation JSON:`, jsonMatch[0]); // DEBUG LOG
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            console.error('Moat validation failed:', error);
        }

        return {
            greenFlags: [],
            redFlags: [],
            strategicPivot: 'Analysis incomplete'
        };
    }

    private async generateRecommendations(warGaming: WarGameResponse[], moat: MoatValidation, roadmap: string): Promise<string[]> {
        const prompt = `Based on the competitive analysis, provide 3-5 actionable strategic recommendations for the user.

Roadmap: ${roadmap}
Competitor Threats: ${JSON.stringify(warGaming.map(w => ({ competitor: w.competitor, counterMove: w.competitorCounterMove, probability: w.probability })))}
Moat Validation: ${JSON.stringify(moat)}

Output STRICT JSON string array: ["Rec 1", "Rec 2", "Rec 3"]`;

        try {
            const result = await callGeminiAgent(
                GeminiCapability.ANALYSIS_MAIN,
                prompt,
                '',
                [],
                true,
                false
            );

            const jsonMatch = result.text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            console.error('Recommendation generation failed:', error);
        }

        return ['Focus on unique value gaps.', 'Accelerate time-to-market for defensible features.'];
    }

    private formatReport(dna: CompetitorDNA[], warGaming: WarGameResponse[], moat: MoatValidation, recommendations: string[]): string {
        let report = `### Competitive Intelligence Report\n\n`;

        report += `#### 🧬 Phase 1: Competitor DNA Extraction\n\n`;
        dna.forEach(d => {
            report += `##### ${d.name}\n`;
            const cash = typeof d.financialFlexibility?.cashOnHand === 'number'
                ? `$${d.financialFlexibility.cashOnHand}M`
                : d.financialFlexibility?.cashOnHand || 'Unknown';

            const rd = typeof d.financialFlexibility?.rdSpend === 'number'
                ? `$${d.financialFlexibility.rdSpend}M`
                : d.financialFlexibility?.rdSpend || 'Unknown';

            report += `**Financial Flexibility**: ${cash} cash, ${rd} R&D (${d.financialFlexibility?.classification ?? 'Unknown'})\n`;
            report += `**Strategic Focus**: ${d.strategicCommitment?.join(', ') ?? 'Unknown'}\n`;
            report += `**Technical Moats**: ${d.technicalMoats?.join(', ') ?? 'Unknown'}\n`;
            report += `**Risk Appetite**: ${d.riskAppetite ?? 'Unknown'}\n\n`;
        });

        report += `#### ⚔️ Phase 2: War-Game Simulation\n\n`;
        warGaming.forEach(w => {
            report += `##### ${w.competitor}\n`;
            report += `**Your Move**: ${w.userMove}\n`;
            report += `**Counter-Move**: ${w.competitorCounterMove}\n`;
            report += `**Timeline**: T+30: ${w.timeline?.T30 ?? 'N/A'}, T+90: ${w.timeline?.T90 ?? 'N/A'}\n\n`;
        });

        report += `#### 🎯 Phase 3: Moat Validation\n\n`;
        report += `**Green Flags**: ${moat.greenFlags?.length ?? 0} defensible features\n`;
        report += `**Red Flags**: ${moat.redFlags?.length ?? 0} copyable features\n`;
        report += `**Strategic Pivot**: ${moat.strategicPivot ?? 'Analysis incomplete'}\n\n`;

        report += `#### 💡 Recommendations\n\n`;
        recommendations.forEach(r => {
            report += `- ${r}\n`;
        });

        return report;
    }

    private getFilingUrl(competitor: CompetitorInput): string {
        if (competitor.regulatoryBody === 'SEC') {
            return `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(competitor.name)}`;
        } else if (competitor.regulatoryBody === 'SEBI') {
            return `https://www.bseindia.com`;
        }
        return 'https://www.sec.gov';
    }
}

export const shadowCompetitorOrchestrator = new ShadowCompetitorOrchestrator();
