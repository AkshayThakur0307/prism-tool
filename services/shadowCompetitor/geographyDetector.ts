// Geography detection service for Shadow Competitor module

export type Region = 'US' | 'India' | 'UK' | 'EU' | 'China' | 'Japan';
export type RegulatoryBody = 'SEC' | 'SEBI' | 'FCA' | 'ESMA' | 'CSRC' | 'FSA';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface GeographyDetection {
    region: Region;
    regulatoryBody: RegulatoryBody;
    confidence: ConfidenceLevel;
    confidenceScore: number; // 0-100
    signals: DetectionSignal[];
    filingUrls: string[];
}

export interface DetectionSignal {
    type: 'ticker' | 'suffix' | 'keyword' | 'domain' | 'default';
    matched: boolean;
    weight: number;
    description: string;
}

/**
 * Detect company geography from company name
 * Uses multi-signal approach with confidence scoring
 */
export function detectGeography(companyName: string): GeographyDetection {
    const name = companyName.trim();
    const signals: DetectionSignal[] = [];
    let totalScore = 0;
    let region: Region = 'US'; // Default
    let regulatoryBody: RegulatoryBody = 'SEC';

    // Signal 1: Stock Exchange Ticker (40% weight)
    const tickerPatterns = [
        { regex: /NYSE:|NASDAQ:|US:/, region: 'US' as Region, body: 'SEC' as RegulatoryBody, exchange: 'NYSE/NASDAQ' },
        { regex: /BSE:|NSE:|IN:/, region: 'India' as Region, body: 'SEBI' as RegulatoryBody, exchange: 'BSE/NSE' },
        { regex: /LSE:|LON:/, region: 'UK' as Region, body: 'FCA' as RegulatoryBody, exchange: 'LSE' },
        { regex: /SHA:|SHE:|CN:/, region: 'China' as Region, body: 'CSRC' as RegulatoryBody, exchange: 'Shanghai/Shenzhen' },
        { regex: /TYO:|JP:/, region: 'Japan' as Region, body: 'FSA' as RegulatoryBody, exchange: 'Tokyo' }
    ];

    for (const { regex, region: r, body: b, exchange } of tickerPatterns) {
        if (regex.test(name)) {
            signals.push({
                type: 'ticker',
                matched: true,
                weight: 40,
                description: `Listed on ${exchange}`
            });
            totalScore += 40;
            region = r;
            regulatoryBody = b;
            break;
        }
    }

    // Signal 2: Legal Entity Suffix (30% weight)
    const suffixPatterns = [
        { patterns: ['Limited', 'Ltd', 'Ltd.', 'Pvt Ltd', 'Private Limited'], region: 'India' as Region, body: 'SEBI' as RegulatoryBody, weight: 30 },
        { patterns: ['Inc', 'Inc.', 'Corp', 'Corp.', 'LLC', 'Corporation'], region: 'US' as Region, body: 'SEC' as RegulatoryBody, weight: 25 },
        { patterns: ['PLC', 'plc'], region: 'UK' as Region, body: 'FCA' as RegulatoryBody, weight: 30 },
        { patterns: ['GmbH', 'AG', 'SE'], region: 'EU' as Region, body: 'ESMA' as RegulatoryBody, weight: 30 },
        { patterns: ['KK', 'Co., Ltd'], region: 'Japan' as Region, body: 'FSA' as RegulatoryBody, weight: 30 }
    ];

    for (const { patterns, region: r, body: b, weight } of suffixPatterns) {
        const matched = patterns.some(suffix => {
            const regex = new RegExp(`\\s${suffix}$|^${suffix}$`, 'i');
            return regex.test(name);
        });

        if (matched && totalScore < 40) { // Only if ticker didn't match
            const matchedSuffix = patterns.find(s => new RegExp(`\\s${s}$|^${s}$`, 'i').test(name));
            signals.push({
                type: 'suffix',
                matched: true,
                weight,
                description: `Entity suffix "${matchedSuffix}"`
            });
            totalScore += weight;
            region = r;
            regulatoryBody = b;
            break;
        }
    }

    // Signal 3: Geographic Keywords (15% weight)
    const keywordPatterns = [
        { keywords: ['India', 'Indian', 'Bharat', 'Mumbai', 'Bangalore', 'Delhi', 'Hyderabad'], region: 'India' as Region, body: 'SEBI' as RegulatoryBody },
        { keywords: ['America', 'American', 'USA', 'US '], region: 'US' as Region, body: 'SEC' as RegulatoryBody },
        { keywords: ['British', 'UK', 'London', 'England'], region: 'UK' as Region, body: 'FCA' as RegulatoryBody },
        { keywords: ['China', 'Chinese', 'Beijing', 'Shanghai'], region: 'China' as Region, body: 'CSRC' as RegulatoryBody },
        { keywords: ['Japan', 'Japanese', 'Tokyo'], region: 'Japan' as Region, body: 'FSA' as RegulatoryBody }
    ];

    for (const { keywords, region: r, body: b } of keywordPatterns) {
        const matched = keywords.some(kw => name.toLowerCase().includes(kw.toLowerCase()));
        if (matched && totalScore < 55) { // Only add if not already highly confident
            const matchedKeyword = keywords.find(kw => name.toLowerCase().includes(kw.toLowerCase()));
            signals.push({
                type: 'keyword',
                matched: true,
                weight: 15,
                description: `Geographic keyword "${matchedKeyword}"`
            });
            totalScore += 15;
            if (totalScore < 40) { // Only override if no strong signal yet
                region = r;
                regulatoryBody = b;
            }
            break;
        }
    }

    // Default signal
    if (signals.length === 0) {
        signals.push({
            type: 'default',
            matched: false,
            weight: 0,
            description: 'No geographic signals detected, defaulting to US (SEC)'
        });
    }

    // Determine confidence level
    const confidenceScore = Math.min(totalScore, 100);
    let confidence: ConfidenceLevel;
    if (confidenceScore >= 90) {
        confidence = 'High';
    } else if (confidenceScore >= 70) {
        confidence = 'Medium';
    } else {
        confidence = 'Low';
    }

    // Filing URLs based on region
    const filingUrlsMap: Record<Region, string[]> = {
        'US': [
            'https://www.sec.gov/edgar/searchedgar/companysearch.html',
            'https://www.sec.gov/cgi-bin/browse-edgar'
        ],
        'India': [
            'https://www.bseindia.com',
            'https://www.nseindia.com',
            'https://www.sebi.gov.in'
        ],
        'UK': [
            'https://www.fca.org.uk',
            'https://www.londonstockexchange.com'
        ],
        'EU': [
            'https://www.esma.europa.eu'
        ],
        'China': [
            'http://www.csrc.gov.cn'
        ],
        'Japan': [
            'https://www.fsa.go.jp'
        ]
    };

    return {
        region,
        regulatoryBody,
        confidence,
        confidenceScore,
        signals: signals.filter(s => s.matched),
        filingUrls: filingUrlsMap[region]
    };
}

// Get flag emoji for region
export function getRegionFlag(region: Region): string {
    const flags: Record<Region, string> = {
        'US': '🇺🇸',
        'India': '🇮🇳',
        'UK': '🇬🇧',
        'EU': '🇪🇺',
        'China': '🇨🇳',
        'Japan': '🇯🇵'
    };
    return flags[region];
}

// Get color for confidence level
export function getConfidenceColor(confidence: ConfidenceLevel): {
    bg: string;
    text: string;
    border: string;
} {
    const colors: Record<ConfidenceLevel, { bg: string; text: string; border: string }> = {
        'High': {
            bg: 'bg-emerald-600/20',
            text: 'text-emerald-300',
            border: 'border-emerald-600/50'
        },
        'Medium': {
            bg: 'bg-yellow-600/20',
            text: 'text-yellow-300',
            border: 'border-yellow-600/50'
        },
        'Low': {
            bg: 'bg-red-600/20',
            text: 'text-red-300',
            border: 'border-red-600/50'
        }
    };
    return colors[confidence];
}
