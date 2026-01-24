
import { SessionState, InteractionEvent, PersonaRole, PersonaAgent, WarRoomContext } from '../../types/warRoom';
import { DiscoveryStage } from '../../types';
import { PersonaRegistry } from './personaRegistry';

export class Moderator {

    /**
     * Main entry point for processing a user's input in the War Room.
     * 1. Updates transcript.
     * 2. Detects intent/conflict.
     * 3. Selects the next speaker (Persona).
     * 4. Updates sentiment.
     */
    static async processInteraction(
        input: string,
        context: SessionState,
        stage: DiscoveryStage,
        stageContext: WarRoomContext, // Updated signature
        availableAgents: PersonaAgent[] // NEW: Pass explicit list of active agents
    ): Promise<SessionState> {

        // 1. Log User Input
        const userEvent: InteractionEvent = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            speakerRole: 'STRATEGIST',
            speakerName: 'You',
            content: input,
            stage: stage
        };

        let updatedContext: SessionState = {
            ...context,
            transcript: [...context.transcript, userEvent],
            currentTurn: undefined
        };

        // 2. Construct LLM Prompt for Dynamic Moderation
        const recentTranscript = updatedContext.transcript.slice(-6).map(t => `${t.speakerRole}: ${t.content}`).join('\n');

        // Define explicit Persona System Prompts for context based on AVAILABLE agents
        const personaContext = availableAgents.map(p =>
            `Role: ${p.role}\nName: ${p.name}\nTrigger Keywords: ${p.keywords.join(', ')}\nPersonality: ${p.toneDescription}\nToolbox: ${p.toolboxDescription || "None"}`
        ).join('\n---\n');

        const validRoles = availableAgents.map(a => a.role).join(" | ");

        const systemPrompt = `
            You are the "War Room Moderator" for a high-stakes product discovery session.
            
            CONTEXT:
            Project Name: ${stageContext.projectMetadata.companyName || "Untitled"}
            Mission: ${stageContext.projectMetadata.missionStatement || "N/A"}
            Current Stage: ${stage}
            
            STAGE DATA (What the team is working on):
            User Inputs (Raw Data): "${stageContext.stageInput.slice(0, 500)}..."
            AI Analysis (Draft Material): "${stageContext.stageOutput.slice(0, 500)}..."
            
            PANELISTS (Your available agents):
            ${personaContext}
            
            YOUR GOAL:
            Analyze the user's latest input ("${input}") and the recent transcript.
            1. Select the Expert Agent best suited to SOLVE the problem.
            2. PERFORM EXPERT ANALYSIS (Chain of Thought):
               - Identify the specific problem.
               - Determine the root cause.
               - Propose a concrete solution.
            3. GENERATE ARTIFACTS:
               - If the solution requires visualization, generate a "MERMAID_DIAGRAM".
               - If it requires logic, generate a "CODE_BLOCK".
               - If it requires planning, generate a "MARKDOWN_TABLE".
            
            OUTPUT JSON ONLY:
            {
                "nextSpeakerRole": "${validRoles}",
                "expertAnalysis": {
                    "problemIdentified": "string",
                    "rootCause": "string",
                    "proposedSolution": "string"
                },
                "responseContent": "string (The verbal explanation)",
                "artifactType": "MERMAID_DIAGRAM" | "CODE_BLOCK" | "MARKDOWN_TABLE" | "NONE",
                "artifactContent": "string (The usage code for the artifact, empty if NONE)",
                "sentimentScore": number (0-100),
                "shouldDebate": boolean
            }
        `;

        try {
            // Lazy import to avoid circular dependency issues if any
            const { callGeminiAgent } = await import('../../services/geminiService');
            const { GeminiCapability } = await import('../../services/modelConfig');

            const response = await callGeminiAgent(
                GeminiCapability.CHAT,
                systemPrompt,
                `Recent Transcript:\n${recentTranscript}\n\nUser Input: ${input}\n\nGenerate next turn JSON with Expert Analysis:`,
                context.contextFiles || [], // Pass multimodal context
                true // jsonMode
            );

            const aiData = JSON.parse(response.text);

            // Look up agent from the PASSED availableAgents list, not just the registry
            const agent = availableAgents.find(a => a.role === aiData.nextSpeakerRole);

            if (agent) {
                const agentEvent: InteractionEvent = {
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    speakerRole: agent.role,
                    speakerName: agent.name,
                    content: aiData.responseContent,
                    sentiment: aiData.sentimentScore / 100, // Normalize to 0-1
                    stage: stage,
                    expertAnalysis: aiData.expertAnalysis,
                    artifactType: aiData.artifactType !== 'NONE' ? aiData.artifactType : undefined,
                    artifactContent: aiData.artifactType !== 'NONE' ? aiData.artifactContent : undefined
                };

                updatedContext = {
                    ...updatedContext,
                    transcript: [...updatedContext.transcript, agentEvent],
                    currentTurn: agent.role,
                    panelSentimentScore: aiData.sentimentScore,
                    pendingInterjection: aiData.shouldDebate ? 'MODERATOR' : undefined // Use pendingInterjection to signal recursion
                };
            }

        } catch (error) {
            console.error("Moderator AI Failed, falling back to heuristic:", error);

            // Fallback Logic (Heuristic) - Simplified to just pick a random available agent or specific role if present
            let nextSpeaker = availableAgents.find(a => a.keywords.some(k => input.toLowerCase().includes(k)));

            if (!nextSpeaker && availableAgents.length > 0) {
                // Fallback to first agent if no keyword match
                nextSpeaker = availableAgents[0];
            }

            if (nextSpeaker) {
                const fallbackEvent: InteractionEvent = {
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    speakerRole: nextSpeaker.role,
                    speakerName: nextSpeaker.name,
                    content: `(Offline Mode) I have specific concerns about "${input}" relevant to my domain.`,
                    stage: stage
                };
                updatedContext = {
                    ...updatedContext,
                    transcript: [...updatedContext.transcript, fallbackEvent],
                    currentTurn: nextSpeaker.role,
                    panelSentimentScore: Math.max(0, updatedContext.panelSentimentScore - 5)
                };
            }
        }

        return updatedContext;
    }

    /**
     * Generates a concise summary of the session based on the transcript.
     * This calls the LLM to synthesize agreements and action items.
     */
    static async generateSessionSummary(transcript: InteractionEvent[]): Promise<string> {
        if (transcript.length === 0) return "No interaction recorded.";

        const transcriptText = transcript.map(t => `${t.speakerRole} (${t.speakerName}): ${t.content}`).join('\n');

        const systemPrompt = `
            You are the "War Room Scribe". Your job is to listen to the debate and synthesize a strategic summary.
            
            Focus on:
            1. **Consensus**: What did the panel agree on?
            2. **Conflict**: What major risks were raised by the Skeptics (CFO/Risk Hawk)?
            3. **Action Items**: Concrete steps the Strategist should take.

            OUTPUT FORMAT (Markdown):
            ## Session Executive Summary
            [2-3 sentence overview]

            ### Critical Risks Identified
            - [Risk 1]
            - [Risk 2]
            
            ### Action Plan
            - [Action 1]
            - [Action 2]
        `;

        try {
            const { callGeminiAgent } = await import('../../services/geminiService');
            const { GeminiCapability } = await import('../../services/modelConfig');

            const response = await callGeminiAgent(
                GeminiCapability.CHAT,
                systemPrompt,
                `Summarize this session:\n\n${transcriptText}`,
                [],
                false // text mode
            );

            return response.text;

        } catch (error) {
            console.error("Moderator Synthesis Failed:", error);
            return "## Synthesis Error\nCould not generate summary. Please check logs.";
        }
    }
}
