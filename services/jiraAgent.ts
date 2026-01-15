
import { jiraService } from './jiraService';

export const JIRA_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "create_ticket",
                "description": "Create a new Jira issue (Epic, Story, Task, or Idea).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "projectKey": { "type": "string", "description": "The Project Key (e.g., 'KAN', 'PROJ'). Overrides default." },
                        "summary": { "type": "string", "description": "The summary/title of the issue." },
                        "description": { "type": "string", "description": "The detailed description of the issue." },
                        "issueType": { "type": "string", "description": "Type of issue: 'Epic', 'Story', 'Task', or 'Idea'. Default is 'Story'." },
                        "parentKey": { "type": "string", "description": "Key of the parent issue (e.g., for Stories linked to an Epic)." }
                    },
                    "required": ["summary", "description"]
                }
            },
            {
                "name": "read_ticket",
                "description": "Get detailed information about a specific Jira issue.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "issueKey": { "type": "string", "description": "The Key of the issue to fetch (e.g., PROJ-123)." }
                    },
                    "required": ["issueKey"]
                }
            },
            {
                "name": "search_tickets",
                "description": "Search for Jira issues using JQL (Jira Query Language).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "jql": { "type": "string", "description": "The JQL query string (e.g., 'project = PROJ AND status = \"In Progress\"')." }
                    },
                    "required": ["jql"]
                }
            },
            {
                "name": "update_ticket",
                "description": "Update specific fields of a Jira issue.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "issueKey": { "type": "string", "description": "The Key of the issue to update." },
                        "fields": { "type": "object", "description": "JSON object of fields to update (e.g., { summary: 'New Title', labels: ['urgent'] })." }
                    },
                    "required": ["issueKey", "fields"]
                }
            },
            {
                "name": "delete_ticket",
                "description": "Delete a Jira issue. REQUIRES USER CONFIRMATION.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "issueKey": { "type": "string", "description": "The Key of the issue to delete." }
                    },
                    "required": ["issueKey"]
                }
            },
            {
                "name": "transition_ticket",
                "description": "Move a Jira issue to a different status (e.g., 'In Progress', 'Done').",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "issueKey": { "type": "string", "description": "The Key of the issue to transition." },
                        "transitionId": { "type": "string", "description": "The ID of the transition to execute (use read_ticket or get_transitions to find IDs)." }
                    },
                    "required": ["issueKey", "transitionId"]
                }
            },
            {
                "name": "get_transitions",
                "description": "Get available workflow transitions for an issue.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "issueKey": { "type": "string", "description": "The Key of the issue." }
                    },
                    "required": ["issueKey"]
                }
            }
        ]
    }
];

export const jiraAgent = {
    executeJiraTool: async (toolCall: any, config: any): Promise<string> => {
        const functionName = toolCall.name;
        const args = toolCall.args;

        // Dynamic Project Key Override
        const effectiveConfig = { ...config };
        if (args.projectKey) {
            effectiveConfig.projectKey = args.projectKey;
            console.log(`[JiraAgent] Using dynamic Project Key from args: ${args.projectKey}`);
        }

        console.log(`[JiraAgent] EXECUTION START: ${functionName}`);
        console.log(`[JiraAgent] Args:`, JSON.stringify(args, null, 2));
        console.log(`[JiraAgent] Config Validation:`, {
            hasProjectKey: !!effectiveConfig.projectKey,
            hasEmail: !!effectiveConfig.email,
            hasApiToken: !!effectiveConfig.apiToken,
            hasDomain: !!effectiveConfig.domain,
            maskedToken: effectiveConfig.apiToken ? `${effectiveConfig.apiToken.substring(0, 4)}...` : 'MISSING'
        });

        if (!effectiveConfig.apiToken || !effectiveConfig.domain || !effectiveConfig.email) {
            console.error("[JiraAgent] MISSING CREDENTIALS. Aborting.");
            return "Error: Missing Jira Credentials (API Token, Domain, or Email). Please check .env.";
        }

        if (!effectiveConfig.projectKey && functionName === 'create_ticket') {
            return "Error: No Project Key specified. Please specify a Project Key (e.g., 'KAN').";
        }

        try {
            switch (functionName) {
                case 'create_ticket':
                    const created = await jiraService.createIssue(effectiveConfig, args.summary, args.description, args.issueType, args.parentKey);
                    return `Successfully created issue ${created.key}: ${created.self}`;

                case 'read_ticket':
                    const issue = await jiraService.getIssue(effectiveConfig, args.issueKey);
                    return JSON.stringify(issue);

                case 'search_tickets':
                    const searchResults = await jiraService.searchIssues(effectiveConfig, args.jql);
                    // Summarize results to save tokens
                    const summary = searchResults.issues.map((i: any) => ({
                        key: i.key,
                        summary: i.fields.summary,
                        status: i.fields.status.name,
                        type: i.fields.issuetype.name
                    }));
                    return JSON.stringify(summary, null, 2);

                case 'update_ticket':
                    await jiraService.updateIssue(effectiveConfig, args.issueKey, args.fields);
                    return `Successfully updated issue ${args.issueKey}.`;

                case 'delete_ticket':
                    // Note: The UI layer (ChatBot) intercepts this call first for confirmation.
                    // This execution happens only AFTER confirmation.
                    await jiraService.deleteIssue(effectiveConfig, args.issueKey);
                    return `Successfully deleted issue ${args.issueKey}.`;

                case 'transition_ticket':
                    await jiraService.transitionIssue(effectiveConfig, args.issueKey, args.transitionId);
                    return `Successfully transitioned issue ${args.issueKey} to transition ID ${args.transitionId}.`;

                case 'get_transitions':
                    const transitions = await jiraService.getTransitions(effectiveConfig, args.issueKey);
                    return JSON.stringify(transitions, null, 2);

                default:
                    return `Error: Unknown tool function ${functionName}`;
            }
        } catch (error: any) {
            console.error(`[JiraAgent] Tool execution failed:`, error);
            return `Error executing ${functionName}: ${error.message}`;
        }
    }
};
