
export enum GeminiCapability {
    REASONING = 'reasoning',
    ANALYSIS_MAIN = 'analysis_main',
    CHAT = 'chat',
    RESEARCH = 'research',
    VISION = 'vision'
}

export const GEMINI_MODELS = {
    THINKING: 'gemini-3-flash-preview', // Verified Thinking Model
    PRO: 'gemini-2.5-pro', // Verified Stable Analysis
    FLASH: 'gemini-2.5-flash', // Verified Stable Flash
    FLASH_EXP: 'gemini-2.0-flash-exp', // Verified for Live API (bidiGenerateContent)
};

export function getModelForCapability(capability: GeminiCapability): string {
    switch (capability) {
        case GeminiCapability.REASONING:
            return GEMINI_MODELS.THINKING;
        case GeminiCapability.ANALYSIS_MAIN:
            return GEMINI_MODELS.PRO;
        case GeminiCapability.CHAT:
            return GEMINI_MODELS.FLASH;
        case GeminiCapability.RESEARCH:
            return GEMINI_MODELS.FLASH_EXP;
        case GeminiCapability.VISION:
            // gemini-2.0-flash-exp is excellent for vision
            return GEMINI_MODELS.FLASH_EXP;
        default:
            return GEMINI_MODELS.FLASH;
    }
}
