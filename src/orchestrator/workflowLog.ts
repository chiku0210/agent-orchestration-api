import type { RunEvent, WorkflowType } from "../contracts/index.js";

/**
 * Console logging for local debugging / log aggregation. Every emitted `RunEvent` is
 * also printed here in a consistent shape: workflow, runId, step, agent, and phase.
 */
export function logRunEvent(e: RunEvent): void {
  // `dag_node_*` / `facet_*` already name the agent; `agent_*` would duplicate.
  if (e.type === "agent_started" || e.type === "agent_finished") {
    if (e.workflow === "market_pulse" && e.agent.role !== "MarketPulseSynthesizer") {
      return;
    }
    if (e.workflow === "spec_forge") {
      return;
    }
  }

  const base = {
    scope: "workflow" as const,
    workflow: e.workflow,
    runId: e.runId,
    event: e.type,
  };

  switch (e.type) {
    case "run_started": {
      console.log("[workflow]", {
        ...base,
        step: "run",
        phase: "started",
        detail: e.input.marketPulseRunId
          ? `marketPulseRunId=${e.input.marketPulseRunId}`
          : "idea-only",
      });
      return;
    }
    case "run_finished": {
      const err = e.error;
      console.log("[workflow]", {
        ...base,
        step: "run",
        phase: "finished",
        status: e.status,
        ...(err?.message ? { error: err.message } : {}),
      });
      return;
    }
    case "agent_started": {
      console.log("[workflow]", {
        ...base,
        step: "agent",
        agent: e.agent.role,
        model: e.agent.model,
        phase: "started",
      });
      return;
    }
    case "agent_finished": {
      console.log("[workflow]", {
        ...base,
        step: "agent",
        agent: e.agent.role,
        model: e.agent.model,
        phase: "finished",
        durationMs: e.durationMs,
      });
      return;
    }
    case "facet_started": {
      console.log("[workflow]", {
        ...base,
        step: "market_pulse_facet",
        facetId: e.facet.id,
        agent: e.facet.agentRole,
        phase: "started",
        label: humanFacetLabel(e.facet.id),
      });
      return;
    }
    case "facet_finished": {
      console.log("[workflow]", {
        ...base,
        step: "market_pulse_facet",
        facetId: e.facet.id,
        agent: e.facet.agentRole,
        phase: "finished",
        durationMs: e.durationMs,
        label: humanFacetLabel(e.facet.id),
      });
      return;
    }
    case "synthesizer_started": {
      console.log("[workflow]", {
        ...base,
        step: "market_pulse_synth",
        agent: e.synthesizer.role,
        phase: "started",
        label: "2 — Synthesize MarketPulse package",
      });
      return;
    }
    case "synthesizer_finished": {
      console.log("[workflow]", {
        ...base,
        step: "market_pulse_synth",
        agent: e.synthesizer.role,
        phase: "finished",
        durationMs: e.durationMs,
        artifact: e.artifactRef,
        label: "2 — Synthesize MarketPulse package",
      });
      return;
    }
    case "dag_node_started": {
      console.log("[workflow]", {
        ...base,
        step: "spec_forge",
        nodeId: e.dag.nodeId,
        agent: e.dag.agentRole,
        phase: "dag_started",
        label: specForgeDagLabel(e.dag.nodeId, e.dag.agentRole),
      });
      return;
    }
    case "dag_node_finished": {
      console.log("[workflow]", {
        ...base,
        step: "spec_forge",
        nodeId: e.dag.nodeId,
        agent: e.dag.agentRole,
        phase: "dag_finished",
        durationMs: e.durationMs,
        summary: e.summary,
        label: specForgeDagLabel(e.dag.nodeId, e.dag.agentRole),
      });
      return;
    }
    case "file_bundle_generated": {
      console.log("[workflow]", {
        ...base,
        step: "spec_forge_artifact",
        phase: "file_bundle",
        fileCount: e.fileBundle.fileCount,
        byteSizeApprox: e.fileBundle.byteSizeApprox,
        label: "3 — File bundle saved",
      });
      return;
    }
    case "spec_forge_html_generated": {
      console.log("[workflow]", {
        ...base,
        step: "spec_forge_artifact",
        phase: "html",
        summary: e.html.summary,
        byteSizeApprox: e.html.byteSizeApprox,
        label: "3 — HTML artifact saved",
      });
      return;
    }
    case "step_started": {
      console.log("[workflow]", { ...base, step: e.step.label, kind: e.step.kind, phase: "step_started" });
      return;
    }
    case "step_finished": {
      console.log("[workflow]", {
        ...base,
        step: e.step.label,
        kind: e.step.kind,
        phase: "step_finished",
        durationMs: e.durationMs,
      });
      return;
    }
    case "step_failed": {
      console.log("[workflow]", {
        ...base,
        step: e.step.label,
        kind: e.step.kind,
        phase: "step_failed",
        error: e.error.message,
      });
      return;
    }
    case "tool_called": {
      console.log("[workflow]", { ...base, tool: e.tool });
      return;
    }
    case "tool_result": {
      console.log("[workflow]", { ...base, tool: e.tool });
      return;
    }
    case "sandbox_ready": {
      console.log("[workflow]", { ...base, step: "sandbox", provider: e.sandbox.provider });
      return;
    }
  }
}

function humanFacetLabel(id: import("../contracts/index.js").FacetId): string {
  const m: Record<string, string> = {
    target_user: "1a — Target user",
    alt_solutions: "1b — Alternatives / substitutes",
    pricing_willingness: "1c — Pricing & willingness to pay",
    distribution: "1d — Distribution / GTM",
    risks_constraints: "1e — Risks & constraints",
  };
  return m[id] ?? id;
}

function specForgeDagLabel(
  nodeId: import("../contracts/index.js").DagNodeId,
  agent: import("../contracts/index.js").AgentRole,
): string {
  if (nodeId === "prd_and_risks") {
    if (agent === "PRDAgent") return "1 — PRD & risks: PRD";
    if (agent === "RiskAgent") return "1 — PRD & risks: Risk";
  }
  if (nodeId === "frontend" && agent === "FrontendAgent") {
    return "HTML — Demo artifact";
  }
  const m: Record<import("../contracts/index.js").DagNodeId, string> = {
    prd_and_risks: "1 — PRD & risks",
    architecture: "2 — Architecture",
    db: "3 — Database & schema",
    backend: "4 — Backend / API",
    frontend: "5 — Frontend / UI",
  };
  return m[nodeId] ?? nodeId;
}

/** Orchestrator: executeRun entry/exit (no EventLogger row for this). */
export function logExecuteRun(p: { runId: string; workflow: WorkflowType; phase: "start" | "end" | "error"; err?: string }): void {
  console.log("[workflow]", {
    scope: "orchestrate",
    workflow: p.workflow,
    runId: p.runId,
    step: "executeRun",
    phase: p.phase,
    ...(p.err ? { error: p.err } : {}),
  });
}

/** Optional milestones (artifact load, fan-out, chained runs). */
export function logWorkflowMilestone(
  p: { runId: string; workflow: WorkflowType; message: string; data?: Record<string, string | number | boolean | null | undefined> },
): void {
  console.log("[workflow]", { scope: "milestone", ...p, ts: new Date().toISOString() });
}
