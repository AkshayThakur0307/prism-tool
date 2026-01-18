import Groq from "groq-sdk";
import { FileContext, GroundingSource } from "../types";
import { searchGoogle } from "./searchService";

export interface GroqAgentResponse {
    text: string;
    sources?: GroundingSource[];
    searchEntryPointHtml?: string;
    toolCall?: {
        name: string;
        args: any;
    };
}

export async function callGroqAgent(
    modelName: string, // Kept for compatibility, but mapped internally
    systemInstruction: string,
    userPrompt: string | { text: string }[],
    contextFiles: FileContext[] = [],
    isThinking: boolean = false,
    useSearch: boolean = false,
    temperature?: number,
    topP?: number,
    tools?: any[] // Support generic tools (Gemini format)
): Promise<GroqAgentResponse> {
    // Normalize userPrompt to string for Groq compatibility
    if (Array.isArray(userPrompt)) {
        userPrompt = userPrompt.map(p => p.text).join('\n\n');
    }

    if (!process.env.GROQ_API_KEY) {
        console.error("GROQ_API_KEY is missing from environment variables. If this is a production build, ensure the key is provided at build time (e.g., in CI/CD or before running 'npm run build').");
        throw new Error("Missing GROQ_API_KEY in environment variables. Check your build-time environment setup.");
    }
    console.log("GROQ_API_KEY is present.");

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, dangerouslyAllowBrowser: true });

    const messages: any[] = [
        {
            role: "system",
            content: isThinking
                ? `You are an expert Strategic Product Analyst with advanced reasoning capabilities.
Before providing your final response, you MUST step through your internal reasoning process within <thought> tags.
In your thinking process:
- Analyze the user's specific request and context.
- Evaluate potential business models or strategies.
- Anticipate risks and contradictions.
- Plan the structure of the final output.

Once your internal thinking is complete, provide the final structured output exactly as requested, following the specific system instructions provided below.

INSTRUCTIONS:
${systemInstruction}`
                : systemInstruction
        }
    ];

    // Image/Multimodal Handling
    const hasMultimodal = contextFiles.some(f => f.mimeType.startsWith('image/'));

    let searchSources: GroundingSource[] = [];

    // RESEARCH GROUNDING LOGIC
    console.log("Research Grounding Check:", { useSearch, hasMultimodal, hasApiKey: !!process.env.SERPER_API_KEY });
    if (useSearch) {
        try {
            // 1. Generate optimized search query if search is enabled
            console.log("Synthesizing Search Query using Llama-3.3-70B...");

            // Truncate userPrompt for search synthesis to avoid context limits and keep it focused
            const searchSynthesisPrompt = userPrompt.length > 2000
                ? userPrompt.slice(0, 2000) + "... [Truncated for search synthesis]"
                : userPrompt;

            console.log("Search Synthesis Prompt Snapshot:", searchSynthesisPrompt.slice(0, 500) + "...");

            const queryResponse = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional research engine. Your task is to extract the core business intent from the user prompt and generate a single, high-impact Google search query. Even if the prompt is brief, generate a query to find relevant market trends or competitors. Output ONLY the query string. Do not use quotes or explanations.'
                    },
                    { role: 'user', content: searchSynthesisPrompt }
                ],
                temperature: 0.3, // Slightly higher for better query variety
                max_tokens: 100,
            });

            console.log("Raw Query Response Choices:", JSON.stringify(queryResponse.choices));

            // Improved cleaning: remove quotes, trailing dots, and markdown code blocks
            let query = queryResponse.choices[0]?.message?.content?.trim() || "";
            query = query.replace(/^["'`]|["'`]$/g, '') // Remove outer quotes
                .replace(/^Query:\s*/i, '')     // Remove "Query: " prefix if added
                .replace(/[\.\?]$/, '')         // Remove trailing punctuation
                .trim();

            console.log("Research Assistant Response:", query);

            if (query && query.length > 3 && !query.toUpperCase().includes('NONE')) {
                console.log("Executing Serper Search for:", query);
                // 2. Perform Search
                const searchResults = await searchGoogle(query);

                if (searchResults.text) {
                    console.log("Search results found and being injected.");
                    // 3. Inject Results
                    searchSources = searchResults.sources;
                    const searchContext = `
=== VERIFIED MARKET DATA (Query: ${query}) ===
${searchResults.text}
=============================================
`;
                    // Prepend search context to system instruction or user prompt
                    userPrompt = `${searchContext}\n\n${userPrompt}`;
                } else {
                    console.log("Search executed but no snippets returned.");
                }
            } else {
                console.log("Search skipped: Query was empty, too short, or 'NONE'.");
            }
        } catch (e: any) {
            console.error("Research step failed with error:", e);
            // Proceed without search
        }
    }

    // Model Selection Logic
    // Groq doesn't support "thinking" in the Google sense, but we map to high-reasoning models
    // 2. Select optimized model for final analysis
    // Use meta-llama/llama-4-scout-17b-16e-instruct ONLY if there are multimodal assets
    // Force openai/gpt-oss-120b for all reasoning and text analysis
    const selectedModel = hasMultimodal ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'openai/gpt-oss-120b';
    console.log(`Using ${selectedModel} for ${hasMultimodal ? 'multimodal analysis' : 'reasoning'}...`);

    // Construct User Message
    if (hasMultimodal) {
        const userContent: any[] = [{ type: "text", text: userPrompt }];

        contextFiles.forEach(file => {
            if (file.mimeType.startsWith('image/')) {
                userContent.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${file.mimeType};base64,${file.content}`
                    }
                });
            } else {
                // Append text files to the prompt text if mixed with images
                userContent[0].text += `\n\n[FILE: ${file.name}]\n${file.content}`;
            }
        });

        messages.push({ role: "user", content: userContent });
    } else {
        // Pure Text Context
        let fullPrompt = userPrompt;
        contextFiles.forEach(file => {
            fullPrompt += `\n\n[FILE: ${file.name}]\n${file.content}`;
        });
        messages.push({ role: "user", content: fullPrompt });
    }

    // Tool Transformation Logic (Gemini -> OpenAI Format)
    let openAITools: any[] | undefined = undefined;
    if (tools && tools.length > 0) {
        openAITools = [];
        tools.forEach(toolWrapper => {
            // Gemini tools are wrapped like { functionDeclarations: [...] } or { googleSearch: {} }
            // Support both camelCase (SDK standard) and snake_case (legacy/API)
            const methods = toolWrapper.functionDeclarations || toolWrapper.function_declarations;

            if (methods) {
                methods.forEach((fd: any) => {
                    openAITools?.push({
                        type: "function",
                        function: {
                            name: fd.name,
                            description: fd.description,
                            parameters: fd.parameters // JSON Schema is compatible
                        }
                    });
                });
            }
        });
        if (openAITools.length === 0) openAITools = undefined;
    }

    console.log("[groqService] Receiving params:", { temperature, topP, isThinking, toolsCount: openAITools?.length });

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: selectedModel,
            temperature: temperature !== undefined ? temperature : (isThinking ? 0.7 : 0.5),
            max_tokens: isThinking ? 4096 : 2048,
            top_p: topP !== undefined ? topP : 1,
            stop: null,
            stream: false,
            tools: openAITools,
            tool_choice: openAITools ? "auto" : "none"
        });

        const choice = chatCompletion.choices[0];
        let text = choice?.message?.content || "";
        let toolCall: { name: string, args: any } | undefined = undefined;

        // Check for Tool Calls
        if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            const tc = choice.message.tool_calls[0];
            if (tc.function) {
                console.log(`[Groq] Tool Call Detected: ${tc.function.name}`);
                try {
                    toolCall = {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments)
                    };
                    // If there is no content, use a placeholder so the UI shows something while executing
                    if (!text) text = `Requesting to execute tool: ${tc.function.name}...`;
                } catch (e) {
                    console.error("Failed to parse Groq tool arguments:", e);
                }
            }
        }

        if (!text && !toolCall) {
            text = "No response received from Groq agent.";
        }

        // CLEANUP: Extract final answer by removing <thought> blocks
        if (isThinking && text) {
            console.log("Processing thinking output...");
            text = text.replace(/<(thought|THOUGHT)>[\s\S]*?<\/(thought|THOUGHT)>/gi, '').trim();
        }

        return {
            text,
            sources: searchSources.length > 0 ? searchSources : undefined,
            searchEntryPointHtml: undefined,
            toolCall: toolCall
        };

    } catch (error: any) {
        console.error("Groq API Error:", error);
        throw new Error(error.message || "Groq communication failure.");
    }
}
