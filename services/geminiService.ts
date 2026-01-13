
import { GoogleGenAI } from "@google/genai";
import { FileContext, GroundingSource } from "../types";
import { searchGoogle } from "./searchService";
import { callGroqAgent } from "./groqService";
import { GeminiCapability, getModelForCapability, GEMINI_MODELS } from "./modelConfig";

// Checking line 1: import { GoogleGenAI } from "@google/genai";
// I will just use the correct import line.

export interface GeminiAgentResponse {
  text: string;
  sources?: GroundingSource[];
  searchEntryPointHtml?: string;
  rawResponse?: any;
}

export async function callGeminiAgent(
  capability: GeminiCapability,
  systemInstruction: string,
  userPrompt: string,
  contextFiles: FileContext[] = [],
  isThinking: boolean = false,
  useSearch: boolean = false,
  modelOverride?: string, // Optional override for manual selection
  tools?: any[], // Support generic tools
  temperature?: number, // Optional temperature override
  topP?: number // Optional topP override
): Promise<GeminiAgentResponse> {
  const hasMultimodal = contextFiles.some(f => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/') || f.mimeType.startsWith('audio/') || f.mimeType === 'application/pdf');

  // 1. Determine Model ID
  let modelToUse = modelOverride || getModelForCapability(capability);

  // Fallback Logic: Ensure we don't use a text-only model if images are present (unless functionality dictates otherwise)
  // For Gemini 2.0/2.5 Flash/Pro, they are multimodal by default, so this check is fairly safe.
  if (hasMultimodal && !modelToUse.toLowerCase().includes('vision') && !modelToUse.toLowerCase().includes('flash') && !modelToUse.toLowerCase().includes('pro') && !modelToUse.toLowerCase().includes('exp')) {
    // This is a safety catch, but modern Gemini models (Pro/Flash) are all multimodal.
    // keeping basic check just in case legacy models invade.
    modelToUse = getModelForCapability(GeminiCapability.VISION);
  }

  // If thinking is enabled, override with the specific thinking model if not already set
  if (isThinking && !modelToUse.includes('thinking')) {
    modelToUse = getModelForCapability(GeminiCapability.REASONING);
  }

  // Define API Client - checking multiple common env var patterns for client-side compatibility
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_API_KEY ||
    process.env.API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_API_KEY;

  if (!apiKey) {
    console.error("Gemini API Key is missing! Please set API_KEY, NEXT_PUBLIC_GEMINI_API_KEY, or VITE_GEMINI_API_KEY.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey || '' });

  // Prepare Content Parts
  const parts: any[] = [{ text: userPrompt }];

  // Handle multimodal context (Images, PDFs, and Videos)
  // hasMultimodal is already calculated at the top
  if (hasMultimodal) {
    console.log('Processing multimodal context...');
  }

  contextFiles.forEach(file => {
    const isFileMultimodal =
      file.mimeType.startsWith('image/') ||
      file.mimeType.startsWith('video/') ||
      file.mimeType.startsWith('audio/') ||
      file.mimeType === 'application/pdf';

    if (isFileMultimodal) {
      parts.push({
        inlineData: {
          data: file.content, // Base64
          mimeType: file.mimeType
        }
      });
    } else {
      // Text context
      parts.push({ text: `[FILE: ${file.name}]\n${file.content}` });
    }
  });

  // If we have multimodal content, ensure we use a model that supports it (Vision capability)
  if (hasMultimodal && !modelToUse.includes('vision') && !modelToUse.includes('flash')) {
    modelToUse = getModelForCapability(GeminiCapability.VISION);
  }

  console.log("[geminiService] Receiving params:", { temperature, topP, isThinking });

  try {
    const config: any = {
      systemInstruction: systemInstruction,
      temperature: temperature !== undefined ? temperature : (isThinking ? 0.7 : 0.4),
      topP: topP !== undefined ? topP : 0.95,
    };

    if (isThinking) {
      // Config for Gemini 3 Flash Preview (Verified)
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: "high"
      };
    }

    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    } else if (tools && tools.length > 0) {
      // Apply Generic Tools if Search is NOT active (mutually exclusive usually for simplicity, or merge)
      // Merging:
      config.tools = [...(config.tools || []), ...tools];
    }

    console.log(`[Gemini] Calling model ${modelToUse} (Thinking: ${isThinking}, Search: ${useSearch}, Tools: ${tools?.length})...`);

    // PRIMARY CALL
    let response = await ai.models.generateContent({
      model: modelToUse,
      contents: { parts },
      config: config,
    });

    // SEARCH FAILOVER LOGIC
    // If search was requested but no grounding metadata was returned, we rely on Serper
    const metadata = response.candidates?.[0]?.groundingMetadata;
    const hasNativeGrounding = metadata?.groundingChunks && metadata.groundingChunks.length > 0;

    if (useSearch && !hasNativeGrounding) {
      console.warn("[Gemini] Native search yielded no grounding. Attempting Serper Failover...");

      // Smart Query Extraction: Attempt to parse the "Active Input" from the prompt structure
      // Matches the format defined in App.tsx runAnalysis
      // Smart Query Extraction: parse Active Input and Module Context
      const activeInputMatch = userPrompt.match(/=== ACTIVE TASK INPUT \(FOCUS HERE\) ===\n"([\s\S]*?)"\n======================================/);
      const moduleContextMatch = userPrompt.match(/=== MODULE CONTEXT \(USE FOR SEARCH RELEVANCE\) ===\n([\s\S]*?)\n=================================================/);

      const cleanInput = activeInputMatch ? activeInputMatch[1].trim() : null;
      const contextInfo = moduleContextMatch ? moduleContextMatch[1].replace(/Stage:|Company:|Vertical:/g, '').replace(/\n/g, ' ').trim() : '';

      // Fallback: Use the whole prompt only if it's short, otherwise skip
      let query = cleanInput;
      if (!query) {
        if (userPrompt.length < 200) {
          query = userPrompt;
        } else {
          console.warn("[Gemini] Could not extract active input for search. Skipping Serper failover to avoid irrelevant queries.");
          query = null;
        }
      } else {
        // Enrich query with context (if extracting clean input succeeded)
        if (contextInfo) {
          query = `${query} ${contextInfo}`.trim().substring(0, 200); // Limit length for Serper
        }
      }

      if (query) {
        const serperResults = await searchGoogle(query);

        if (serperResults.text) {
          console.log("[Gemini] Serper results found. Re-prompting Gemini with injected context.");
          const searchContext = `
=== FALLBACK SEARCH CONTEXT (Source: Google via Serper) ===
Query Used: "${query}"
Results:
${serperResults.text}
===========================================================
`;
          parts.push({ text: searchContext });

          // Re-run the call without the googleSearch tool (since we have manual context now)
          // Keep generic tools if they exist
          config.tools = tools && tools.length > 0 ? tools : undefined;

          response = await ai.models.generateContent({
            model: modelToUse,
            contents: { parts },
            config: config,
          });

          // Manually construct a response structure that mimics native grounding for sources
          return {
            text: response.text || "No response received.",
            sources: serperResults.sources, // Use Serper sources
            searchEntryPointHtml: undefined,
            rawResponse: response // Allow access to function calls if needed
          };
        }
      }
    }

    const text = response.text || "No response received from agent.";

    // Extract grounding metadata if available (from Native Search)
    const sources: GroundingSource[] = [];
    let searchEntryPointHtml: string | undefined = undefined;

    // If we didn't do the failover, use the native metadata
    if (!sources.length && metadata) {
      // 1. Extract Chunks (URLs)
      const chunks = metadata.groundingChunks;
      if (chunks) {
        chunks.forEach((chunk: any) => {
          if (chunk.web && chunk.web.uri) {
            sources.push({
              title: chunk.web.title || chunk.web.uri,
              uri: chunk.web.uri
            });
          }
        });
      }
      // 2. Extract Search Entry Point
      if (metadata.searchEntryPoint?.renderedContent) {
        searchEntryPointHtml = metadata.searchEntryPoint.renderedContent;
      }
    }

    const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

    return {
      text,
      sources: uniqueSources.length > 0 ? uniqueSources : undefined,
      searchEntryPointHtml,
      rawResponse: response // Return raw for tool parsing
    };

  } catch (error: any) {
    console.error(`[Gemini] Error: ${error.message}. Initiating LLM FAILOVER to Groq...`);

    // LLM FAILOVER LOGIC -> Call Groq
    try {
      return await callGroqAgent(
        'openai/gpt-oss-120b', // Fallback model
        systemInstruction,
        userPrompt,
        contextFiles,
        isThinking, // Groq service handles mapping this to system prompt instructions
        useSearch, // Groq service handles Serper search internally
        temperature, // Pass original temperature
        topP // Pass original topP
      );
    } catch (groqError: any) {
      console.error(`[Gemini] FATAL: Fallback to Groq also failed: ${groqError.message}`);
      throw new Error("All AI services failed. Please check your connection or API keys.");
    }
  }



}

export async function refineInputText(text: string, contextType: string = 'general'): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_API_KEY ||
    process.env.API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_API_KEY;

  if (!apiKey) {
    console.warn("Gemini API Key missing for refinement.");
    return text;
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const prompt = `
    Role: Expert Technical Writer & Product Manager.
    Task: Refine the following user input to be professional, clear, and structured.
    Context: ${contextType} (Product Discovery App).
    
    Rules:
    1. Fix grammar and spelling.
    2. Remove conversational fluff.
    3. Use bullet points or concise paragraphs where appropriate.
    4. Maintain the original meaning and intent.
    5. Return ONLY the refined text.
    
    Input:
    "${text}"
  `;

  try {
    const result = await ai.models.generateContent({
      model: GEMINI_MODELS.FLASH,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 }
    });

    const candidate = result.candidates?.[0];
    if (candidate && candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
      return candidate.content.parts[0].text ? candidate.content.parts[0].text.trim() : text;
    }
    return text;

  } catch (error) {
    console.error("Refinement Failed:", error);
    console.log("Initiating Failover to Groq for Refinement...");

    try {
      // Failover to Groq
      const groqResponse = await callGroqAgent(
        'openai/gpt-oss-120b', // Fallback model
        'You are an expert technical editor.', // System instruction
        prompt,
        [],
        false, // No thinking
        false  // No search
      );
      return groqResponse.text || text;
    } catch (groqError) {
      console.error("Groq Refinement also failed:", groqError);
      return text; // Return original if both fail
    }
  }
}
