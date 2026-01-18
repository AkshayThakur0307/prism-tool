
import { NotionResource } from '../types';

export const notionService = {
    /**
     * Search for pages/databases accessible by the integration
     */
    search: async (accessToken: string, query: string = ''): Promise<NotionResource[]> => {
        try {
            const response = await fetch('/notion-api/search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    query,
                    sort: {
                        direction: 'descending',
                        timestamp: 'last_edited_time'
                    },
                    filter: {
                        value: 'page',
                        property: 'object'
                    }
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Notion Search Failed: ${response.status} ${err}`);
            }

            const data = await response.json() as any;

            return data.results.map((item: any) => ({
                id: item.id,
                title: item.properties?.title?.title?.[0]?.plain_text ||
                    item.properties?.Name?.title?.[0]?.plain_text ||
                    'Untitled Page',
                type: item.object,
                icon: item.icon?.emoji || null,
                url: item.url
            }));

        } catch (e: any) {
            console.error("Notion Search Error", e);
            throw e;
        }
    },

    /**
     * Recursively fetch page content as Markdown
     */
    getPageContent: async (accessToken: string, pageId: string): Promise<string> => {
        let markdown = '';

        // Get Metadata first to get title
        try {
            const pageRes = await fetch(`/notion-api/pages/${pageId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Notion-Version': '2022-06-28'
                }
            });
            if (pageRes.ok) {
                const pageData = await pageRes.json() as any;
                const title = pageData.properties?.title?.title?.[0]?.plain_text || 'Untitled';
                markdown += `# ${title}\n\n`;
            }
        } catch (e) { console.warn("Could not fetch page title", e); }


        // Fetch Block Children (Recursive)
        const fetchBlocks = async (blockId: string, indent: number = 0): Promise<string> => {
            let content = '';
            let hasMore = true;
            let cursor: string | undefined = undefined;

            while (hasMore) {
                const url = `/notion-api/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Notion-Version': '2022-06-28'
                    }
                });

                if (!response.ok) break;
                const data = await response.json() as any;

                for (const block of data.results) {
                    const text = notionService.blockToMarkdown(block);
                    if (text) content += `${'  '.repeat(indent)}${text}\n`;

                    if (block.has_children) {
                        content += await fetchBlocks(block.id, indent + 1);
                    }
                }

                hasMore = data.has_more;
                cursor = data.next_cursor;
                console.log(`[NotionService] Fetched batch of ${data.results.length} blocks. Has more: ${hasMore}`);
            }
            return content;
        };

        const content = await fetchBlocks(pageId);
        console.log(`[NotionService] Final Content Length: ${content.length} chars`);
        markdown += content;
        return markdown;
    },

    /**
     * Convert specific block types to Markdown
     */
    blockToMarkdown: (block: any): string => {
        const type = block.type;
        const data = block[type];
        const text = data?.rich_text?.map((t: any) => t.plain_text).join('') || '';

        switch (type) {
            case 'paragraph': return text ? `${text}\n` : '\n';
            case 'heading_1': return `# ${text}\n`;
            case 'heading_2': return `## ${text}\n`;
            case 'heading_3': return `### ${text}\n`;
            case 'bulleted_list_item': return `- ${text}`;
            case 'numbered_list_item': return `1. ${text}`;
            case 'to_do': return `- [${data.checked ? 'x' : ' '}] ${text}`;
            case 'toggle': return `> ${text}`;
            case 'quote': return `> ${text}\n`;
            case 'code': return `\`\`\`${data.language}\n${text}\n\`\`\`\n`;
            case 'divider': return `---`;
            default: return '';
        }
    },

    /**
     * Helper: Chunk content into 2000-char blocks for Notion API
     */
    chunkContent: (content: string): any[] => {
        const MAX_LENGTH = 2000;
        const chunks = [];

        for (let i = 0; i < content.length; i += MAX_LENGTH) {
            chunks.push({
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: [{ type: 'text', text: { content: content.substring(i, i + MAX_LENGTH) } }]
                }
            });
        }
        return chunks;
    },

    /**
     * Create a new page in Notion
     */
    createPage: async (accessToken: string, parentId: string, title: string, content: string): Promise<any> => {
        try {
            // Chunk content to avoid size limits
            const blocks = notionService.chunkContent(content);

            const response = await fetch('/notion-api/pages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    parent: { page_id: parentId }, // Assuming parent is a page for now, could be database_id
                    properties: {
                        title: [
                            {
                                text: {
                                    content: title
                                }
                            }
                        ]
                    },
                    children: blocks
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Notion Create Page Failed: ${response.status} ${err}`);
            }

            return await response.json();
        } catch (e: any) {
            console.error("Notion Create Page Error", e);
            throw e;
        }
    },

    /**
     * Append blocks to an existing page
     */
    appendBlock: async (accessToken: string, blockId: string, content: string): Promise<any> => {
        try {
            // Chunk content to avoid size limits
            const blocks = notionService.chunkContent(content);

            const response = await fetch(`/notion-api/blocks/${blockId}/children`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    children: blocks
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Notion Append Block Failed: ${response.status} ${err}`);
            }

            return await response.json();
        } catch (e: any) {
            console.error("Notion Append Block Error", e);
            throw e;
        }
    }
};
