
import React from 'react';
import { DiscoveryStage } from './types';

export const STAGE_CONFIGS = {
  [DiscoveryStage.MARKET_RESEARCH]: {
    title: 'Market Research',
    description: 'Map the strategic landscape and identify core objectives.',
    icon: <i className="fas fa-compass"></i>,
    label: 'Market Research',
    placeholder: "Start by describing your product vision, the problem you're solving, or a raw business case...",
    cta: "Synthesize Market Research",
    regenerateCta: "Re-Analyze Market Research",
    agentName: "Strategy Orchestrator",
    systemInstruction: `You are an expert Strategic Product Analyst. 
    Analyze the problem statement and business context. 
    Your output MUST include:
    1. A detailed Market Research (Market, Users, Value Prop, Risks).
    2. A "COMPETITIVE INTELLIGENCE" section: Based on the provided competitors and vertical, identify 3-5 direct and indirect competitors. Use a table to compare their key strengths and critical weaknesses.
    3. A "DIFFERENTIATION STRATEGY" section: Propose 3-5 unique value propositions or "Strategic Moats" that differentiate our product from the competition.
    4. A section titled "### CLARIFICATION QUESTIONS" containing exactly 3-5 numbered questions for the user to answer to help refine the Business Overview Document in the next stage.
    Format your response with clear headers and professional structure. Use a uniform 14px-equivalent font style for tables and lists.`,
    statusMessages: [
      "Parsing strategic objectives...",
      "Mapping competitive landscape...",
      "Identifying user archetypes...",
      "Formulating structural questions..."
    ]
  },
  [DiscoveryStage.BOD]: {
    title: 'Business Overview Document (BOD)',
    description: 'Construct a deep dive into the business logic and entity architecture.',
    icon: <i className="fas fa-file-invoice"></i>,
    label: 'BOD',
    placeholder: "Provide additional details on operational flows or business constraints...",
    cta: "Draft BOD",
    regenerateCta: "Regenerate BOD",
    agentName: "Business Architect",
    systemInstruction: `You are a Senior Business Architect. 
    Based on the Market Research and previous context, create a Business Overview Document.
    Define: Business Goals, Scope, Core Entities, and Process Flows.
    
    SPECIAL REQUIREMENT: Include a "STRATEGIC POSITIONING" section. Deepen the competitive analysis by defining how our product's business logic (e.g., pricing, exclusive data access, or network effects) creates a sustainable competitive advantage over the direct and indirect competitors previously identified.
    
    IMPORTANT: If a reference format file is provided, strictly adhere to its sections, table structures, and professional tone.
    Your output MUST include a section titled "### CLARIFICATION QUESTIONS" with 3-5 specific questions to refine the KPI definition.
    Use tables for entity definitions. Ensure all tables have consistent styling.`,
    statusMessages: [
      "Defining business scope...",
      "Extracting core entities...",
      "Mapping operational flows...",
      "Validating business logic...",
      "Formulating refinement questions..."
    ]
  },
  [DiscoveryStage.KPI]: {
    title: 'Metrics & Performance',
    description: 'Establish the success criteria and measurement framework.',
    icon: <i className="fas fa-chart-pie"></i>,
    label: 'KPIs',
    placeholder: "Specify business goals, industry benchmarks, or data tracking requirements...",
    cta: "Establish Metrics",
    regenerateCta: "Re-Calculate KPIs",
    agentName: "Performance Analyst",
    systemInstruction: `You are a Product Data Scientist. 
    Define the North Star, leading, and lagging indicators based on the provided BOD and Market Research.
    Provide measurement strategies and success thresholds.
    IMPORTANT: If a reference format file is provided, strictly follow its data visualization and metrics reporting structure.
    Your output MUST include a section titled "### CLARIFICATION QUESTIONS" with 3-5 questions to help detailed story mapping in the final stage.`,
    statusMessages: [
      "Defining growth levers...",
      "Calculating success thresholds...",
      "Mapping data sources...",
      "Aligning with business value..."
    ]
  },
  [DiscoveryStage.EPICS]: {
    title: 'Epics & User Stories',
    description: 'Transform strategy into an executable engineering backlog.',
    icon: <i className="fas fa-tasks"></i>,
    label: 'Backlog',
    placeholder: "Tech stack constraints, team capacity, or non-functional requirements...",
    cta: "Generate Backlog",
    regenerateCta: "Regenerate Backlog",
    agentName: "TPM Backlog Agent",
    systemInstruction: `You are a Technical Product Manager. 
    Convert everything into high-level Engineering Epics and granular User Stories. 
    Address both Functional and Non-Functional requirements (Security, Performance, Scale).
    IMPORTANT: If a reference format file is provided, strictly use its Story and Epic templates.

    CRITICAL OUTPUT FORMATTING RULES (Required for Auto-Parsing):
    1. You MUST start each Epic with a header in this exact format: "## Epic [Number]: [Name]"
    2. You MUST start each User Story with a header in this exact format: "### Story [Number]: [Name]"
    3. Under each story header, provide the "As a... I want... So that..." description and a list of Acceptance Criteria.
    
    Example:
    ## Epic 1: Authentication Core
    ### Story 1: User Login
    As a user...
    
    Your output MUST include a final "### CLARIFICATION QUESTIONS" section for any implementation ambiguities.`,
    statusMessages: [
      "Decomposing into epics...",
      "Writing technical user stories...",
      "Defining Gherkin ACs...",
      "Drafting non-functional requirements...",
      "Prioritizing by strategic value..."
    ]
  }
};
