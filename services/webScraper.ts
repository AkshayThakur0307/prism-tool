import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';

export async function scrapeUrl(url: string): Promise<string> {
    try {
        // Reverting to AllOrigins per user request
        console.log(`Scraping URL via AllOrigins: ${url}`);

        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&timestamp=${Date.now()}`;

        const response = await fetch(proxyUrl);
        console.log(`Proxy response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Proxy Error Details: ${errorText}`);
            throw new Error(`Failed to fetch URL via proxy: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { contents: string };
        const html = data.contents;

        if (!html || html.length < 100) {
            console.warn("Proxy returned suspiciously short or empty content.");
            throw new Error("No substantial content returned from AllOrigins proxy.");
        }

        // 1. Sanitize the HTML to prevent XSS (even though we are just parsing, it's good practice)
        const cleanHtml = DOMPurify.sanitize(html);

        // 2. Parse HTML string into a DOM Document
        const parser = new DOMParser();
        const doc = parser.parseFromString(cleanHtml, "text/html");

        // 3. Use Readability to extract the main article content
        const reader = new Readability(doc);
        const article = reader.parse();

        // 4. Sanitize Content Aggressively (remove non-printable chars that break Gemini JSON)
        let rawText = "";
        let title = "No Title";

        if (!article) {
            // Fallback
            rawText = doc.body.innerText;
            title = "(Fallback Extraction)";
        } else {
            title = article.title || "No Title";
            rawText = article.textContent;
        }

        // Clean: remove control chars, collapse spaces, truncate to 8000 (safe for Flash 2.5 context mix)
        const cleanText = rawText
            .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000);

        return `URL: ${url}\nTITLE: ${title}\n\nCONTENT:\n${cleanText}`;

    } catch (error: any) {
        console.error(`Scraping error for ${url}:`, error);
        return `[FAILED TO SCRAPE URL: ${url} - Error: ${error.message}]`;
    }
}
