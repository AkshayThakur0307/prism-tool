
import { GoogleGenAI } from "@google/genai";
import { FileContext, GroundingSource } from "../types";
import { searchGoogle } from "./searchService";
import { callGroqAgent } from "./groqService";
import { GeminiCapability, getModelForCapability } from "./modelConfig";

export interface GeminiAgentResponse {
  text: string;
  sources?: GroundingSource[];
  searchEntryPointHtml?: string;
}

export async function callGeminiAgent(
  capabilityOrModel: GeminiCapability | string,
  systemInstruction: string,
  userPrompt: string,
  contextFiles: FileContext[] = [],
  isThinking: boolean = false,
  useSearch: boolean = false
): Promise<GeminiAgentResponse> {
  // 1. Determine Model ID
  // 1. Determine Model ID
  // Check if the input string acts as a known capability (e.g. 'analysis_main') and map it if so.
  // Otherwise, treat it as a direct model ID (e.g. 'gemini-1.5-pro').
  const knownCapabilities = Object.values(GeminiCapability) as string[];
  let modelToUse = knownCapabilities.includes(capabilityOrModel)
    ? getModelForCapability(capabilityOrModel as GeminiCapability)
    : capabilityOrModel;

  // If thinking is enabled, override with the specific thinking model if not already set
  if (isThinking && !modelToUse.includes('thinking')) {
    modelToUse = getModelForCapability(GeminiCapability.REASONING);
  }

  // Define API Client - checking multiple common env var patterns for client-side compatibility
  // Note: Vite uses import.meta.env.VITE_... by default. process.env requires explicit define in vite.config.ts.
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
  const hasMultimodal = contextFiles.some(f =>
    f.mimeType.startsWith('image/') ||
    f.mimeType.startsWith('video/') ||
    f.mimeType === 'application/pdf'
  );

  contextFiles.forEach(file => {
    const isFileMultimodal =
      file.mimeType.startsWith('image/') ||
      file.mimeType.startsWith('video/') ||
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

  try {
    const config: any = {
      systemInstruction: systemInstruction,
      temperature: isThinking ? 0.7 : 0.4,
      topP: 0.95,
    };

    if (isThinking) {
      // 2026 Config for Gemini 3 Flash Thinking
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: "high"
      };
    }

    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    console.log(`[Gemini] Calling model ${modelToUse} (Thinking: ${isThinking}, Search: ${useSearch})...`);

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

      // 1. Synthesize a query (simple heuristic for now: use first 200 chars of prompt)
      // Ideally we'd ask the LLM to generate a query, but to save latency we'll check if Serper finds anything for the main topic
      // Better: Use the searchService to run a query based on the prompt

      // To be safe and context-aware, let's just trigger Serper with the userPrompt truncated
      const query = userPrompt.length > 100 ? userPrompt.substring(0, 100) : userPrompt;

      const serperResults = await searchGoogle(query);

      if (serperResults.text) {
        console.log("[Gemini] Serper results found. Re-prompting Gemini with injected context.");

        // Inject results into a new prompt
        const searchContext = `
=== FALLBACK SEARCH CONTEXT (Source: Google via Serper) ===
${serperResults.text}
===========================================================
`;
        parts.push({ text: searchContext });

        // Re-run the call without the googleSearch tool (since we have manual context now)
        delete config.tools;

        response = await ai.models.generateContent({
          model: modelToUse,
          contents: { parts },
          config: config,
        });

        // Manually construct a response structure that mimics native grounding for sources
        return {
          text: response.text || "No response received.",
          sources: serperResults.sources, // Use Serper sources
          searchEntryPointHtml: undefined
        };
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
      searchEntryPointHtml
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
        useSearch // Groq service handles Serper search internally
      );
    } catch (groqError: any) {
      console.error(`[Gemini] FATAL: Fallback to Groq also failed: ${groqError.message}`);
      throw new Error("All AI services failed. Please check your connection or API keys.");
    }
  }
}
