import { ConfluenceConfig, ConfluencePage } from '../types';

export const confluenceService = {
    /**
     * Search Confluence Pages using CQL (Confluence Query Language)
     * @param rawCql If true, 'query' is treated as the full CQL string. If false (default), searches title ~ query.
     */
    searchPages: async (config: ConfluenceConfig, query: string, rawCql: boolean = false): Promise<ConfluencePage[]> => {
        try {
            // CQL: type=page AND title ~ "query"
            const cql = rawCql ? query : `type="page" AND title ~ "${query}"`;
            const encodedCql = encodeURIComponent(cql);

            // Pass domain in query for robust proxy routing (headers can be unreliable locally)
            const response = await fetch(`/confluence-api/content/search?cql=${encodedCql}&proxy_domain=${encodeURIComponent(config.domain)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
                    'X-Confluence-Domain': config.domain
                }
            });

            if (!response.ok) {
                throw new Error(`Confluence Search Failed: ${response.status} ${await response.text()}`);
            }

            const data: any = await response.json();

            return data.results.map((item: any) => ({
                id: item.id,
                title: item.title,
                spaceKey: item.space?.key || '',
                version: item.version?.number || 1,
                url: `${config.domain.startsWith('http') ? config.domain : 'https://' + config.domain}/wiki${item._links.webui}`
            }));
        } catch (error) {
            console.error("Confluence Search Error:", error);
            throw error;
        }
    },

    /**
     * Get specific page content (Storage Format -> Simplified)
     */
    getPageContent: async (config: ConfluenceConfig, pageId: string): Promise<string> => {
        try {
            // Expand body.storage to get the content
            const response = await fetch(`/confluence-api/content/${pageId}?expand=body.storage,version`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
                    'X-Confluence-Domain': config.domain
                }
            });

            if (!response.ok) {
                throw new Error(`Confluence Read Failed: ${response.status}`);
            }

            const data: any = await response.json();
            const rawHtml = data.body.storage.value;

            // Simple HTML to Text conversion (or return HTML if Agent can handle it)
            // Ideally we use a library like 'turndown', but for now manual strip or returning HTML is safer for context.
            // Let's strip tags for cleaner token usage, or keep structure.
            // Returning raw HTML is often fine for LLMs as they understand it.
            return `Title: ${data.title}\nID: ${data.id}\nLink: ${data._links.base}${data._links.webui}\n\nContent:\n${rawHtml}`;
        } catch (error) {
            console.error("Confluence Read Error:", error);
            throw error;
        }
    },

    /**
     * Create a new page
     */
    createPage: async (config: ConfluenceConfig, title: string, content: string, parentId?: string): Promise<any> => {
        try {
            const payload: any = {
                title: title,
                type: 'page',
                space: { key: config.spaceKey },
                body: {
                    storage: {
                        value: content, // Agent should provide HTML or we wrap text in <p>
                        representation: 'storage'
                    }
                }
            };

            if (parentId) {
                payload.ancestors = [{ id: parentId }];
            }

            const response = await fetch(`/confluence-api/content`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
                    'Content-Type': 'application/json',
                    'X-Confluence-Domain': config.domain
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Confluence Create Failed: ${await response.text()}`);
            }

            return await response.json();

        } catch (error) {
            console.error("Confluence Create Error:", error);
            throw error;
        }
    },

    /**
     * Append content to a page (Read -> Append -> Update)
     * Confluence requires sending the ENTIRE body for an update.
     */
    appendContent: async (config: ConfluenceConfig, pageId: string, newContent: string): Promise<any> => {
        try {
            // 1. Get current content + version
            const currentRes = await fetch(`/confluence-api/content/${pageId}?expand=body.storage,version,space,ancestors`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
                    'X-Confluence-Domain': config.domain
                }
            });
            const currentData: any = await currentRes.json();
            const currentVersion = currentData.version.number;
            const currentBody = currentData.body.storage.value;

            // 2. Update with appended content
            const updatedBody = `${currentBody}<p>${newContent}</p>`; // Basic append

            const payload = {
                version: { number: currentVersion + 1 },
                title: currentData.title,
                type: 'page',
                body: {
                    storage: {
                        value: updatedBody,
                        representation: 'storage'
                    }
                }
            };

            const updateRes = await fetch(`/confluence-api/content/${pageId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
                    'Content-Type': 'application/json',
                    'X-Confluence-Domain': config.domain
                },
                body: JSON.stringify(payload)
            });

            if (!updateRes.ok) {
                throw new Error(`Confluence Update Failed: ${await updateRes.text()}`);
            }

            return await updateRes.json();

        } catch (error) {
            console.error("Confluence Append Error:", error);
            throw error;
        }
    }
};
