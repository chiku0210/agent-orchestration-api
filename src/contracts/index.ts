export type WorkflowType = "market_pulse" | "spec_forge";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type StepKind =
  | "router"
  | "market_pulse_orchestrator"
  | "market_pulse_facet"
  | "market_pulse_synthesizer"
  | "spec_forge_dag_node"
  | "spec_forge_scribe"
  | "tool";

export type AgentRole =
  | "RouterAgent"
  | "MarketPulseOrchestrator"
  | "TargetUserAgent"
  | "AltSolutionsAgent"
  | "PricingWillingnessAgent"
  | "DistributionAgent"
  | "RisksConstraintsAgent"
  | "MarketPulseSynthesizer"
  | "PRDAgent"
  | "ArchitectureAgent"
  | "DBAgent"
  | "BackendAgent"
  | "FrontendAgent"
  | "RiskAgent"
  | "ScribeAgent";

export type DagNodeId =
  | "prd_and_risks"
  | "architecture"
  | "db"
  | "backend"
  | "frontend";

export type FacetId =
  | "target_user"
  | "alt_solutions"
  | "pricing_willingness"
  | "distribution"
  | "risks_constraints";

export type RunEventBase = {
  id: string; // uuid
  runId: string; // uuid
  ts: number; // unix millis
  workflow: WorkflowType;
};

export type RunEvent =
  | (RunEventBase & {
      type: "run_started";
      status: "running";
      input: {
        prompt: string;
        marketPulseRunId?: string;
      };
    })
  | (RunEventBase & {
      type: "run_finished";
      status: Exclude<RunStatus, "queued" | "running">;
      error?: { message: string; code?: string };
    })
  | (RunEventBase & {
      type: "step_started";
      step: { kind: StepKind; label: string };
    })
  | (RunEventBase & {
      type: "step_finished";
      step: { kind: StepKind; label: string };
      durationMs: number;
    })
  | (RunEventBase & {
      type: "step_failed";
      step: { kind: StepKind; label: string };
      error: { message: string; code?: string };
    })
  | (RunEventBase & {
      type: "agent_started";
      agent: {
        role: AgentRole;
        model: string;
        constraints?: {
          timeoutMs?: number;
          maxTokens?: number;
        };
      };
    })
  | (RunEventBase & {
      type: "agent_finished";
      agent: {
        role: AgentRole;
        model: string;
        outcome?: "succeeded" | "timed_out" | "failed" | "degraded";
        error?: { message: string; code?: string };
      };
      durationMs: number;
    })
  | (RunEventBase & {
      type: "facet_started";
      facet: { id: FacetId; agentRole: AgentRole };
    })
  | (RunEventBase & {
      type: "facet_finished";
      facet: { id: FacetId; agentRole: AgentRole };
      durationMs: number;
      summary: string;
    })
  | (RunEventBase & {
      type: "dag_node_started";
      dag: { nodeId: DagNodeId; agentRole: AgentRole };
    })
  | (RunEventBase & {
      type: "dag_node_finished";
      dag: { nodeId: DagNodeId; agentRole: AgentRole };
      durationMs: number;
      summary: string;
    })
  | (RunEventBase & {
      type: "tool_called";
      tool: { name: string; args: unknown };
    })
  | (RunEventBase & {
      type: "tool_result";
      tool: { name: string; result: unknown };
    })
  | (RunEventBase & {
      type: "synthesizer_started";
      synthesizer: { role: "MarketPulseSynthesizer" };
    })
  | (RunEventBase & {
      type: "synthesizer_finished";
      synthesizer: { role: "MarketPulseSynthesizer" };
      durationMs: number;
      artifactRef: { kind: "market_pulse_package"; runId: string };
    })
  | (RunEventBase & {
      type: "file_bundle_generated";
      fileBundle: { fileCount: number; byteSizeApprox: number };
    })
  | (RunEventBase & {
      type: "spec_forge_html_generated";
      html: { summary: string; byteSizeApprox: number };
    })
  | (RunEventBase & {
      type: "sandbox_ready";
      sandbox: { provider: "sandpack" | "webcontainers" };
    });

export type MarketPulseVerdict = "build" | "do_not_build" | "pivot" | "needs_validation";

export type MarketPulsePackage = {
  version: 1;
  runId: string;
  createdAt: number; // unix millis
  featureIdea: string;
  market_fit_summary: {
    verdict: MarketPulseVerdict;
    confidence: number; // 0..1
    rationale: string;
    assumptions: string[];
  };
  personas_jtbd: Array<{
    persona: string;
    jobToBeDone: string;
    painIntensity: "low" | "medium" | "high";
    currentWorkarounds: string[];
  }>;
  competitive_landscape: Array<{
    name: string;
    category: "competitor" | "substitute";
    strengths: string[];
    weaknesses: string[];
    differentiatorsForUs: string[];
  }>;
  value_hypotheses: string[];
  pricing_hypotheses: Array<{
    valueMetric: string;
    pricePointRange: string;
    notes: string;
  }>;
  mvp_scope: {
    goals: string[];
    nonGoals: string[];
    mustHave: string[];
    niceToHave: string[];
  };
  success_metrics: Array<{
    metric: string;
    target: string;
    measurementPlan: string;
  }>;
  validation_plan: Array<{
    experiment: string;
    timeBox: string;
    successCriteria: string;
  }>;
  open_questions: string[];
};

export type SpecForgeArtifacts = {
  version: 1;
  runId: string;
  createdAt: number; // unix millis
  marketPulseRunId: string;
  prd: {
    problemStatement: string;
    users: string[];
    userStories: string[];
    acceptanceCriteria: string[];
    outOfScope: string[];
  };
  architecture: {
    overview: string;
    apiContracts: Array<{
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      requestSchema: unknown;
      responseSchema: unknown;
    }>;
    dataModelNotes: string[];
    fileStructure: Array<{ path: string; purpose: string }>;
  };
  db: {
    sqlMigrations: Array<{ filename: string; sql: string }>;
    notes: string[];
  };
  backend: {
    notes: string[];
  };
  frontend: {
    notes: string[];
  };
  risks: Array<{
    category: "security" | "privacy" | "reliability" | "abuse" | "compliance";
    risk: string;
    mitigation: string;
  }>;
  taskPlan: Array<{
    id: string;
    title: string;
    description: string;
    dependsOn?: string[];
  }>;
};

export type FileBundleItem = {
  path: string;
  content: string;
};

export type SpecForgeHtmlArtifact = {
  summary: string;
  html: string;
};
