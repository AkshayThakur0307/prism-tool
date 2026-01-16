
import { Pinecone } from '@pinecone-database/pinecone';
import { VectorNamespace } from '../types';

// NOTE: In production, do NOT expose the API Key in the frontend build.
// Use a proxy server (Cloud Functions) to handle the Pinecone connection.
const apiKey = import.meta.env.VITE_PINECONE_API_KEY;
const indexName = import.meta.env.VITE_PINECONE_INDEX || 'product-discovery-index';

let pinecone: Pinecone | null = null;

const getClient = () => {
    if (!pinecone && apiKey) {
        pinecone = new Pinecone({
            apiKey: apiKey,
            // namespace can be set per request
        });
    }
    return pinecone;
};

// Embedding Helper (Using Gemini for Embeddings to match Pinecone vectors)
// This assumes vectors in Pinecone were generated using "text-embedding-004" model
// access to embedding model via @google/genai requires the same key
import { GoogleGenAI } from "@google/genai";
const genAI = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });

async function getEmbedding(text: string): Promise<number[]> {
    try {
        const result = await genAI.models.embedContent({
            model: "text-embedding-004",
            contents: [{ parts: [{ text: text }] }]
        });

        // Check for different response structures just in case
        return (result as any).embedding?.values || (result as any).values || [];
    } catch (e) {
        console.error("Embedding generation failed:", e);
        return [];
    }
}

export const searchPinecone = async (namespace: VectorNamespace, query: string): Promise<string> => {
    const client = getClient();

    if (!client) {
        console.warn("Pinecone Client not initialized. Check VITE_PINECONE_API_KEY.");
        return "";
    }

    try {
        console.log(`[Pinecone] Generating embedding for: "${query}"...`);
        const vector = await getEmbedding(query);

        if (!vector || vector.length === 0) {
            throw new Error("Failed to generate embedding vector.");
        }

        console.log(`[Pinecone] Querying namespace: ${namespace}...`);
        const index = client.index(indexName);

        const queryResponse = await index.namespace(namespace).query({
            vector: vector,
            topK: 5,
            includeMetadata: true
        });

        if (queryResponse.matches.length === 0) {
            console.log("No matches found in Pinecone.");
            return "";
        }

        // Synthesize Context
        const matches = queryResponse.matches.map(match => {
            const text = match.metadata?.text || JSON.stringify(match.metadata); // Fallback if no text field
            return `[Score: ${match.score?.toFixed(2)}] ${text}`;
        }).join("\n---\n");

        return matches;

    } catch (error) {
        console.error("Pinecone Search Error:", error);
        return ""; // Fail gracefully so app doesn't crash
    }
};
