
import { FileContext } from '../types';

interface JiraConfig {
    domain: string;
    email: string;
    apiToken: string;
    projectKey: string;
}

export interface JiraIssueResponse {
    id: string;
    key: string;
    self: string;
}

export const jiraService = {
    /**
     * Helper to encode credentials for Basic Auth
     */
    getAuthHeader: (email: string, apiToken: string) => {
        return `Basic ${btoa(`${email}:${apiToken}`)}`;
    },

    /**
     * Create an Epic or Story in Jira
     * Note: We use a proxy logic if needed, but for now we'll attempt direct with proper headers
     */
    /**
     * Create an Epic, Story, Task, or JPD Idea in Jira
     */
    createIssue: async (config: JiraConfig, summary: string, description: string, issueType: 'Epic' | 'Story' | 'Task' | 'Idea' = 'Story', parentKey?: string): Promise<JiraIssueResponse> => {
        // Use local Vite proxy which forwards to the configured Jira instance
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue`;

        // Jira strictly enforces a 255 character limit for summaries
        const safeSummary = summary.substring(0, 250);
        const safeDescription = description || "No description provided.";

        const body: any = {
            fields: {
                project: {
                    key: config.projectKey,
                },
                summary: safeSummary,
                description: {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: safeDescription,
                                },
                            ],
                        },
                    ],
                },
                issuetype: {
                    name: issueType,
                },
            },
        };

        if (parentKey) {
            body.fields.parent = { key: parentKey };
        }

        console.log(`[JiraService] Creating ${issueType}: ${safeSummary}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Atlassian-Token': 'no-check'
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error("Jira API Response Error:", errorData);
            throw new Error(`Jira Error: ${errorData}`);
        }

        return response.json();
    },

    /**
     * Get Issue Details
     */
    getIssue: async (config: JiraConfig, issueKey: string): Promise<any> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue/${issueKey}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch issue ${issueKey}`);
        }

        return response.json();
    },

    /**
     * Search Issues using JQL
     */
    searchIssues: async (config: JiraConfig, jql: string): Promise<any> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to search issues with JQL: ${jql}`);
        }

        return response.json();
    },

    /**
     * Update Issue (Summary, Description, etc.)
     */
    updateIssue: async (config: JiraConfig, issueKey: string, fields: any): Promise<void> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue/${issueKey}`;

        const body = { fields };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Failed to update issue ${issueKey}`);
        }
    },

    /**
     * Delete Issue
     */
    deleteIssue: async (config: JiraConfig, issueKey: string): Promise<void> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue/${issueKey}`;

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to delete issue ${issueKey}`);
        }
    },

    /**
     * Get Transitions
     */
    getTransitions: async (config: JiraConfig, issueKey: string): Promise<any> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get transitions for ${issueKey}`);
        }

        return response.json();
    },

    /**
     * Transition Issue
     */
    transitionIssue: async (config: JiraConfig, issueKey: string, transitionId: string): Promise<void> => {
        const baseUrl = '/jira-api';
        const url = `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`;

        const body = {
            transition: {
                id: transitionId
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': jiraService.getAuthHeader(config.email, config.apiToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Failed to transition issue ${issueKey} to state ${transitionId}`);
        }
    },

    /**
     * Parses the AI-generated Epics/Stories and pushes them to Jira
     */
    syncBacklog: async (config: JiraConfig, aiOutput: string, onProgress: (msg: string) => void) => {
        try {
            onProgress("Analyzing backlog structure...");

            // Look for Epics. Handles "### Epic: Name", "## Epic 1: Name", "### Name (Epic)" etc.
            const epicRegex = /(?:^|\n)(#{1,4})\s+(?:Epic\s*\d*[:\s-]*|)(.*?)\n([\s\S]*?)(?=\n#|$|### CLARIFICATION)/gi;

            let match;
            const epicsFound: { title: string, content: string }[] = [];

            while ((match = epicRegex.exec(aiOutput)) !== null) {
                if (match[2] && match[2].trim()) {
                    epicsFound.push({
                        title: match[2].trim(),
                        content: match[3] || ""
                    });
                }
            }

            if (epicsFound.length === 0) {
                const fallbackRegex = /(?:^|\n)(#{2,3})\s+(?!CLARIFICATION QUESTIONS)(.*?)\n([\s\S]*?)(?=\n#{2,3}\s+|$)/gi;
                while ((match = fallbackRegex.exec(aiOutput)) !== null) {
                    if (match[1] && match[1].trim()) {
                        epicsFound.push({
                            title: match[1].trim(),
                            content: match[2] || ""
                        });
                    }
                }
            }

            if (epicsFound.length === 0) {
                console.error("Failed to parse AI output:", aiOutput);
                throw new Error("Could not identify any Epics in the output. Please ensure the AI has generated headers for each Epic.");
            }

            for (const epicData of epicsFound) {
                const title = epicData.title;
                onProgress(`Creating Epic: ${title}...`);

                // CLEAN THE EPIC CONTENT: Remove the stories from the epic description so it's clean
                const epicDescription = epicData.content.split(/[\-\*]\s+(?:\*\*|)(?:User\s*Story|As\s+a)/i)[0].trim();

                // Create the Epic with the AI output as description
                const epic = await jiraService.createIssue(config, title, epicDescription || `Strategic Epic: ${title}`, 'Epic');
                onProgress(`Epic created: ${epic.key}. syncing stories...`);

                // Look for User Stories within the epic content
                const storyRegex = /(?:^|\n)\s*[\-\*]\s+(?:\*\*|)(?:User\s*Story|As\s+a.*?I\s+want.*?So\s+that).*?(?:\*\*|)[:\s-]*([\s\S]*?)(?=\n\s*[\-\*]\s+|$)/gi;

                let storyMatch;
                let storyCount = 0;
                while ((storyMatch = storyRegex.exec(epicData.content)) !== null) {
                    const fullStoryContent = storyMatch[0].replace(/^\s*[\-\*]\s+/, '').trim();
                    if (fullStoryContent) {
                        storyCount++;
                        // Use a shorter summary for the story title
                        const storySummary = fullStoryContent.length > 100
                            ? fullStoryContent.substring(0, 100) + "..."
                            : fullStoryContent;

                        onProgress(`Creating Story ${storyCount} for ${epic.key}...`);
                        await jiraService.createIssue(config, storySummary, fullStoryContent, 'Story', epic.key);
                    }
                }

                if (storyCount === 0) {
                    onProgress(`No specific stories found for ${epic.key}, creating a general task.`);
                    await jiraService.createIssue(config, `Implement ${title}`, epicData.content.substring(0, 1000), 'Story', epic.key);
                }
            }

            onProgress("Sync Complete!");
        } catch (error: any) {
            console.error("Jira Sync Failed:", error);
            onProgress(`Sync Failed: ${error.message}`);
            throw error;
        }
    }
};
