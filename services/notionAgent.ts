import { notionService } from './notionService';
import { NotionConfig } from '../types';

export const NOTION_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "create_page",
                "description": "Create a new page in Notion. Useful for saving notes, summaries, or reports.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "The title of the new page." },
                        "content": { "type": "string", "description": "The initial content of the page (text)." },
                        "parentId": { "type": "string", "description": "ID of the parent page. IF OMITTED, defaults to the first configured resource." }
                    },
                    "required": ["title", "content"]
                }
            },
            {
                "name": "append_to_page",
                "description": "Append text content to an existing Notion page.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pageId": { "type": "string", "description": "The ID of the page to append to." },
                        "content": { "type": "string", "description": "The text content to append." }
                    },
                    "required": ["pageId", "content"]
                }
            },
            {
                "name": "search_pages",
                "description": "Search for Notion pages by title.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "The search query string." }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_page",
                "description": "Read the full content of a specific Notion page.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pageId": { "type": "string", "description": "The ID of the page to read." }
                    },
                    "required": ["pageId"]
                }
            }
        ]
    }
];

export const notionAgent = {
    executeNotionTool: async (toolCall: any, config: NotionConfig): Promise<string> => {
        const functionName = toolCall.name;
        const args = toolCall.args;

        console.log(`[NotionAgent] EXECUTION START: ${functionName}`);
        console.log(`[NotionAgent] Args:`, JSON.stringify(args, null, 2));

        if (!config.accessToken) {
            return "Error: No Notion Access Token configured.";
        }

        try {
            switch (functionName) {
                case 'create_page':
                    // Default to first selected resource if no parent specified
                    const parentId = args.parentId || config.selectedResources[0]?.id;
                    if (!parentId) return "Error: No parent page specified and no default resources configured.";

                    const newPage = await notionService.createPage(config.accessToken, parentId, args.title, args.content);
                    return `Successfully created Notion page: ${newPage.url}`;

                case 'append_to_page':
                    await notionService.appendBlock(config.accessToken, args.pageId, args.content);
                    return `Successfully appended content to page ${args.pageId}.`;

                case 'search_pages':
                    const results = await notionService.search(config.accessToken, args.query);
                    return JSON.stringify(results.map(r => ({ id: r.id, title: r.title, url: r.url })), null, 2);

                case 'read_page':
                    const content = await notionService.getPageContent(config.accessToken, args.pageId);
                    return content;

                default:
                    return `Error: Unknown tool function ${functionName}`;
            }
        } catch (error: any) {
            console.error(`[NotionAgent] Tool execution failed:`, error);
            return `Error executing ${functionName}: ${error.message}`;
        }
    }
};
