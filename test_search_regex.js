
const userPrompt = `
GLOBAL PROJECT CONTEXT:
- Company Name: Acme Inc
- Mission: To build great things

=== ACTIVE TASK INPUT (FOCUS HERE) ===
"Analyze the market size for AI productivity tools"
======================================

=== BACKGROUND HISTORY (READ-ONLY CONTEXT) ===
NOTE: The following history is for context only. DO NOT perform searches based on errors, logs, or issues found in this history unless explicitly requested in the Active Task Input.
[MARKET RESEARCH]:
Some output here...
==============================================

USER RESPONSES TO CLARIFICATIONS: {}

STAGE-SPECIFIC REFERENCE URLS:
`;

const activeInputMatch = userPrompt.match(/=== ACTIVE TASK INPUT \(FOCUS HERE\) ===\n"([\s\S]*?)"\n======================================/);
const cleanInput = activeInputMatch ? activeInputMatch[1].trim() : null;

console.log("Extracted Input:", cleanInput);

if (cleanInput === "Analyze the market size for AI productivity tools") {
    console.log("TEST PASSED");
} else {
    console.log("TEST FAILED");
}
