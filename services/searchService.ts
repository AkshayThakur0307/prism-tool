
import { GroundingSource } from "../types";

export async function searchGoogle(query: string): Promise<{ text: string, sources: GroundingSource[] }> {
    console.log("searchGoogle called with query:", query);

    const apiKey = import.meta.env.VITE_SERPER_API_KEY || process.env.SERPER_API_KEY || process.env.NEXT_PUBLIC_SERPER_API_KEY;

    if (!apiKey) {
        console.warn("SERPER_API_KEY mismatch or missing. Skipping search.");
        return { text: "", sources: [] };
    }

    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": process.env.SERPER_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ q: query, num: 5 })
        });

        if (!response.ok) {
            throw new Error(`Serper API error: ${response.statusText}`);
        }

        const data = await response.json();
        const snippets: string[] = [];
        const sources: GroundingSource[] = [];

        // Parsing Organic Results
        if (data.organic) {
            data.organic.forEach((item: any) => {
                snippets.push(`[${item.title}]: ${item.snippet}`);
                sources.push({
                    title: item.title,
                    uri: item.link
                });
            });
        }

        // Parsing Knowledge Graph (if any)
        if (data.knowledgeGraph) {
            snippets.unshift(`[Knowledge Graph]: ${data.knowledgeGraph.description}`);
            if (data.knowledgeGraph.website) {
                sources.push({ title: data.knowledgeGraph.title, uri: data.knowledgeGraph.website });
            }
        }

        return {
            text: snippets.join("\n\n"),
            sources: sources
        };

    } catch (error) {
        console.error("Search failed:", error);
        return { text: "", sources: [] };
    }
}
