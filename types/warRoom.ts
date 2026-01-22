
import { DiscoveryStage, ProjectMetadata } from '../types';

export interface WarRoomContext {
    stageInput: string;
    stageOutput: string;
    projectMetadata: ProjectMetadata;
}

export type PersonaRole = 'PRODUCT_MANAGER' | 'ARCHITECT' | 'TECH_LEAD' | 'DELIVERY_MANAGER' | 'END_USER' | 'DEVELOPER' | 'LEAD_UX' | 'MODERATOR';

export interface InteractionEvent {
    id: string;
    timestamp: number;
    speakerRole: PersonaRole | 'STRATEGIST'; // STRATEGIST = The human user
    speakerName: string; // e.g., "CFO (Marcus)" or "You"
    content: string; // The text transcript
    sentiment?: number; // 0.0 to 1.0 (Critical to Positive)
    stage?: DiscoveryStage; // The stage context this interaction belongs to
    relatedArtifactId?: string; // If they are referencing a specific Jira ticket or Doc

    // Expert Co-Pilot Fields
    expertAnalysis?: {
        problemIdentified: string;
        rootCause: string;
        proposedSolution: string;
    };
    artifactType?: 'MERMAID_DIAGRAM' | 'CODE_BLOCK' | 'MARKDOWN_TABLE' | 'NONE';
    artifactContent?: string;
}

export interface PersonaAgent {
    id: string;
    role: PersonaRole;
    name: string;
    avatarUrl?: string; // Optional URL for UI avatar
    systemPrompt: string; // The core personality and incentive instructions
    voiceId?: string; // ID for TTS service (e.g., ElevenLabs)
    toneDescription?: string; // e.g., "Analytical, Dry, Fast-paced"
    toolboxDescription?: string; // e.g., "Generates Mermaid Diagrams"
    keywords: string[]; // Keywords that might trigger this agent to interject
}

export interface SessionState {
    id: string;
    startTime: number;
    isActive: boolean;
    activeStage: DiscoveryStage;
    participants: PersonaRole[]; // Which agents are present in this session
    transcript: InteractionEvent[];
    panelSentimentScore: number; // 0-100%
    currentTurn?: PersonaRole | 'STRATEGIST';
    pendingInterjection?: PersonaRole; // If an agent is "raising their hand"
}
