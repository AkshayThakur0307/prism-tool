
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
    createIssue: async (config: JiraConfig, summary: string, description: string, issueType: 'Epic' | 'Story' | 'Task' = 'Story', parentKey?: string): Promise<JiraIssueResponse> => {
        // Use the Cloudflare Worker proxy if configured, otherwise local Vite proxy
        const proxyBase = (import.meta.env.VITE_JIRA_PROXY_URL as string) || '/jira-api';
        const url = `${proxyBase.replace(/\/$/, '')}/rest/api/3/issue`;

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
