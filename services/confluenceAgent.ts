import { confluenceService } from './confluenceService';
import { ConfluenceConfig } from '../types';

export const CONFLUENCE_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "create_confluence_page",
                "description": "Create a new page in Confluence. Use this to save reports, notes, or structured data.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "The title of the new page." },
                        "content": { "type": "string", "description": "The page content (HTML supported)." },
                        "parentId": { "type": "string", "description": "Optional ID of a parent page to nest this under." }
                    },
                    "required": ["title", "content"]
                }
            },
            {
                "name": "append_to_confluence_page",
                "description": "Append content to an existing Confluence page.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pageId": { "type": "string", "description": "The ID of the page to update." },
                        "content": { "type": "string", "description": "The content to append." }
                    },
                    "required": ["pageId", "content"]
                }
            },
            {
                "name": "search_confluence",
                "description": "Search Confluence pages by title.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "The search query." }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_confluence_page",
                "description": "Read the full content of a specific Confluence page.",
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

export const confluenceAgent = {
    executeConfluenceTool: async (toolCall: any, config: ConfluenceConfig): Promise<string> => {
        const functionName = toolCall.name;
        const args = toolCall.args;

        console.log(`[ConfluenceAgent] EXECUTION START: ${functionName}`);

        if (!config.apiToken || !config.domain || !config.email) {
            return "Error: Confluence credentials not configured.";
        }

        try {
            switch (functionName) {
                case 'create_confluence_page':
                    const newPage = await confluenceService.createPage(config, args.title, args.content, args.parentId);
                    const link = `${config.domain.startsWith('http') ? config.domain : 'https://' + config.domain}/wiki${newPage._links.webui}`;
                    return `Successfully created Confluence page: ${link} (ID: ${newPage.id})`;

                case 'append_to_confluence_page':
                    await confluenceService.appendContent(config, args.pageId, args.content);
                    return `Successfully appended content to page ${args.pageId}.`;

                case 'search_confluence':
                    const results = await confluenceService.searchPages(config, args.query);
                    return JSON.stringify(results.map(r => ({ id: r.id, title: r.title, url: r.url })), null, 2);

                case 'read_confluence_page':
                    const content = await confluenceService.getPageContent(config, args.pageId);
                    return content;

                default:
                    return `Error: Unknown tool function ${functionName}`;
            }
        } catch (error: any) {
            console.error(`[ConfluenceAgent] Tool execution failed:`, error);
            return `Error executing ${functionName}: ${error.message}`;
        }
    }
};
