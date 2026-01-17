
import { FigmaConfig, figmaService } from './figmaService';

export const FIGMA_TOOLS = [
    {
        functionDeclarations: [
            {
                name: "figma_get_file_structure",
                description: "Get the structure (pages, layers) of a Figma file. Useful for understanding the design layout.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        fileKey: {
                            type: "STRING",
                            description: "The unique key of the Figma file (from the URL)"
                        }
                    },
                    required: ["fileKey"]
                }
            },
            {
                name: "figma_read_comments",
                description: "Read comments from a Figma file. Useful for gathering feedback/requirements from designs.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        fileKey: {
                            type: "STRING",
                            description: "The unique key of the Figma file"
                        }
                    },
                    required: ["fileKey"]
                }
            },
            {
                name: "figma_get_node_details",
                description: "Get detailed properties of specific nodes (layers/frames) in a Figma file.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        fileKey: {
                            type: "STRING",
                            description: "The unique key of the Figma file"
                        },
                        nodeIds: {
                            type: "ARRAY",
                            items: {
                                type: "STRING"
                            },
                            description: "List of Node IDs to fetch details for"
                        }
                    },
                    required: ["fileKey", "nodeIds"]
                }
            }
        ]
    }
];

export const figmaAgent = {
    executeFigmaTool: async (toolName: string, args: any, config?: FigmaConfig) => {
        // Ensure config exists
        const safeConfig = config || {};

        try {
            switch (toolName) {
                case "figma_get_file_structure":
                    return await figmaService.getFile(safeConfig, args.fileKey);

                case "figma_read_comments":
                    return await figmaService.getComments(safeConfig, args.fileKey);

                case "figma_get_node_details":
                    return await figmaService.getNodes(safeConfig, args.fileKey, args.nodeIds);

                default:
                    throw new Error(`Unknown Figma tool: ${toolName}`);
            }
        } catch (error: any) {
            console.error(`Figma Tool Execution Failed (${toolName}):`, error);
            return { error: error.message || "Unknown Figma Error" };
        }
    }
};
