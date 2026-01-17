
export interface FigmaConfig {
    accessToken?: string; // Optional if configured in Env
}

export const figmaService = {
    /**
     * Helper to handle Figma API errors
     */
    handleFigmaError: async (response: Response, action: string) => {
        if (response.status === 429) {
            console.warn(`Figma API Rate Limit Hit (${action})`);
            throw new Error("⏳ Figma Rate Limit Exceeded. Please wait 60 seconds.");
        }

        const errorData = await response.text();
        console.error(`Figma API ${action} Error:`, errorData);
        let errorMessage = `Figma Error: ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorData);
            if (errorJson.err) {
                errorMessage = errorJson.err; // Figma API typically returns { err: "message" }
            } else if (errorJson.message) {
                errorMessage = errorJson.message;
            }
        } catch (e) {
            errorMessage = errorData;
        }
        throw new Error(errorMessage);
    },

    /**
     * Get local headers (Token is injected by Proxy if missing, but we can pass it if provided)
     */
    getHeaders: (config: FigmaConfig) => {
        const headers: any = {
            'Accept': 'application/json'
        };
        if (config.accessToken) {
            headers['X-Figma-Token'] = config.accessToken;
        }
        return headers;
    },

    /**
     * Helper to summarize a Figma Node to save tokens
     */
    summarizeNode: (node: any): any => {
        const summary: any = {
            id: node.id,
            name: node.name,
            type: node.type
        };

        // Capture text content
        if (node.type === 'TEXT' && node.characters) {
            summary.characters = node.characters;
        }

        // Capture Component Instance properties
        if (node.componentProperties) {
            summary.componentProperties = {};
            // console.log(`[Figma] Processing props for ${node.name}`, node.componentProperties);

            for (const [key, value] of Object.entries(node.componentProperties)) {
                // Clean the key (remove internal Figma IDs like #12:34)
                const cleanKey = key.split('#')[0];

                // Determine the actual value
                const propVal: any = value;
                if (propVal?.value !== undefined) {
                    summary.componentProperties[cleanKey] = propVal.value;
                } else {
                    summary.componentProperties[cleanKey] = propVal;
                }
            }
        }

        if (node.children) {
            summary.children = node.children.map((child: any) => figmaService.summarizeNode(child));
        }

        return summary;
    },

    /**
     * Get File JSON (Summarized)
     * GET /v1/files/:key
     */
    getFile: async (config: FigmaConfig, fileKey: string) => {
        const cleanKey = fileKey.split('?')[0];
        const baseUrl = '/figma-api';

        // --- ATTEMPT 1: Optimized Fetch (Depth=2) ---
        try {
            const url = `${baseUrl}/files/${cleanKey}?depth=2`;
            const response = await fetch(url, { method: 'GET', headers: figmaService.getHeaders(config) });

            if (response.status === 400) throw new Error("TRY_FALLBACK");
            if (!response.ok) await figmaService.handleFigmaError(response, "Get File (Depth=2)");

            const data = await response.json() as any;
            return {
                name: data.name,
                lastModified: data.lastModified,
                thumbnailUrl: data.thumbnailUrl,
                params: "depth=2",
                structure: data.document?.children?.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    children: p.children?.map((c: any) => figmaService.summarizeNode(c))
                }))
            };
        } catch (e: any) {
            if (e.message !== "TRY_FALLBACK") throw e;
        }

        // --- ATTEMPT 2: Full Fetch (No Depth - for FigJam) ---
        try {
            console.warn("Retrying Figma fetch without depth limit (FigJam mode)...");
            const url = `${baseUrl}/files/${cleanKey}`;
            const response = await fetch(url, { method: 'GET', headers: figmaService.getHeaders(config) });

            if (response.status === 400) throw new Error("TRY_NODE_FALLBACK");
            if (!response.ok) await figmaService.handleFigmaError(response, "Get File (Full)");

            const data = await response.json() as any;
            return {
                name: data.name,
                lastModified: data.lastModified,
                thumbnailUrl: data.thumbnailUrl,
                params: "full",
                structure: data.document?.children?.map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    children: p.children?.map((c: any) => figmaService.summarizeNode(c))
                }))
            };
        } catch (e: any) {
            if (e.message !== "TRY_NODE_FALLBACK") throw e;
        }

        // --- ATTEMPT 3: Root Node Fetch & GRACEFUL EXIT ---
        try {
            console.warn("Retrying Figma fetch via Root Node (0:0)...");
            const url = `${baseUrl}/files/${cleanKey}/nodes?ids=0:0`;
            const response = await fetch(url, { method: 'GET', headers: figmaService.getHeaders(config) });

            // If even this fails, return a safe "Unsupported" object instead of crashing
            if (!response.ok) {
                console.error(`Attempt 3 Failed: ${response.status}`);
                return {
                    name: `Unreadable File (${fileKey})`,
                    lastModified: new Date().toISOString(),
                    thumbnailUrl: "",
                    params: "error-fallback",
                    structure: [
                        {
                            id: "error",
                            name: "⚠️ File Type Not Supported by API",
                            type: "ERROR",
                            children: [{ id: "help", name: "This file (Slides/FigJam?) cannot be read by the external API.", type: "INFO" }]
                        }
                    ]
                };
            }

            const data = await response.json() as any;
            const rootNode = data.nodes['0:0']?.document;

            if (!rootNode) throw new Error("Node 0:0 not found");

            return {
                name: data.name || "Untitled (Node Fetch)",
                lastModified: data.lastModified,
                thumbnailUrl: data.thumbnailUrl,
                params: "node-fallback",
                structure: [figmaService.summarizeNode(rootNode)]
            };
        } catch (e) {
            // Ultimate fallback
            return {
                name: `Unreadable File (${fileKey})`,
                lastModified: new Date().toISOString(),
                params: "final-fallback",
                structure: [{ id: "error", name: "Unable to read file structure", type: "ERROR" }]
            };
        }
    },

    /**
     * Get Comments
     * GET /v1/files/:key/comments
     */
    getComments: async (config: FigmaConfig, fileKey: string) => {
        const baseUrl = '/figma-api';
        const url = `${baseUrl}/files/${fileKey}/comments`;

        const response = await fetch(url, {
            method: 'GET',
            headers: figmaService.getHeaders(config)
        });

        if (!response.ok) {
            await figmaService.handleFigmaError(response, "Get Comments");
        }

        const data = await response.json() as any;
        return data.comments.map((c: any) => ({
            id: c.id,
            user: c.user?.handle,
            message: c.message,
            created_at: c.created_at,
            resolved: c.resolved_at ? true : false
        }));
    },

    /**
     * Get Node Details
     * GET /v1/files/:key/nodes?ids=:ids
     */
    getNodes: async (config: FigmaConfig, fileKey: string, nodeIds: string[]) => {
        const baseUrl = '/figma-api';
        const queryParams = new URLSearchParams({
            ids: nodeIds.join(',')
        });
        const url = `${baseUrl}/files/${fileKey}/nodes?${queryParams.toString()}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: figmaService.getHeaders(config)
        });

        if (!response.ok) {
            await figmaService.handleFigmaError(response, "Get Nodes");
        }

        const data = await response.json() as any;

        // Map and summarize output nodes
        const result: any = {};
        Object.keys(data.nodes).forEach(key => {
            result[key] = figmaService.summarizeNode(data.nodes[key].document);
        });

        return result;
    }
};
