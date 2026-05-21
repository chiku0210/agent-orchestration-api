# Agent Orchestration API

A high-performance, event-driven backend for complex multi-agent workflows. This system moves beyond simple "prompt-and-response" to orchestrate multi-stage pipelines with real-time feedback, hard time budgets, and persistent state.

This is the engine behind the [Multi-Agent Showcase](https://multi-agent-showcase.nielless.com). It implements two sophisticated orchestration patterns: **Fan-out/Fan-in Research** and **Sequential Handoff Specification**.

---

## Core Workflows

### 1. MarketPulse (Fan-out / Fan-in)
Dispatches a product idea to five specialized research agents in parallel to analyze the market from different facets.
- **Agents:** Target User, Alternative Solutions, Pricing & Willingness, Distribution Strategy, and Risks & Constraints.
- **Synthesis:** Once all facets resolve (or degrade gracefully), a **MarketPulseSynthesizer** aggregates the findings into a structured market fit package.
- **Resilience:** Built-in sleep-staggering to handle high-concurrency RPM limits and automatic "degraded mode" if a facet times out.

### 2. SpecForge (Sequential Handoff)
Transforms a MarketPulse package into a full technical specification and interactive prototype.
- **Pipeline:** `PRD Agent` → `Risk Agent` → `Architecture Agent` → `DemoScribe Agent`.
- **Context Handoff:** Each agent receives the structured output of previous steps, refining the prompt based on user feedback.
- **Final Output:** Generates a complete HTML/CSS prototype and technical architecture document.

---

## Key Features

- **Real-time SSE Streaming:** Exposes an event-driven interface via `/v1/runs/:runId/events`. Clients receive live updates as agents start, finish, and hit milestones.
- **Hard Time Budgets:** Global and per-agent timeouts ensure workflows don't hang. If an agent fails or stalls, the system uses "fallback" logic to keep the pipeline moving.
- **Dynamic Model Routing:** Configure specific LLMs for different roles via environment variables. Use 70B models for synthesis and fast 20B models for parallel facets.
- **Automatic JSON Repair:** Integrated logic to catch, repair, and retry LLM outputs that fail schema validation.
- **Persistence:** Every run, event, and artifact is persisted in PostgreSQL, allowing for session resumption and auditability.

---

## Tech Stack

- **Inference:** NVIDIA NIM (OpenAI SDK) (Llama 3.1 8B, Llama 3.1 70B)
- **Runtime:** Node.js (ESM) + TypeScript
- **Framework:** Express v5 (Beta)
- **Database:** PostgreSQL (Schema-backed)
- **Validation:** Zod (Strict schema enforcement for all agent handoffs)
- **Concurrency:** Promise-based parallel execution with throttling

---

## Project Structure

```text
src/
├── agents/        # Specialized agent logic (System prompts + IO schemas)
├── orchestrator/  # Core workflow engines, event bus, and budget logic
├── contracts/     # Zod definitions shared across the system
├── storage/       # Database layer (Postgres pool, artifact persistence)
├── config/        # Model routing and environment configuration
└── index.ts       # Express API and SSE route handlers
```

---

## API Reference

### Create a Run
`POST /v1/runs`
Trigger a new workflow execution.
```json
{
  "workflow": "market_pulse" | "spec_forge",
  "prompt": "A platform for peer-to-peer boat rentals",
  "marketPulseRunId": "uuid" // Optional, required for spec_forge
}
```

### Stream Events (SSE)
`GET /v1/runs/:runId/events`
Subscribe to real-time progress. Supports "Event Replay" for late-joining clients.

### Retrieve Artifacts
`GET /v1/runs/:runId/artifacts`
Fetch the final MarketPulse package or SpecForge HTML.

---

## Getting Started

1. **Clone & Install**
   ```bash
   git clone https://github.com/chiku0210/agent-orchestration-api.git
   npm install
   ```

2. **Environment Setup**
   Copy `.env.example` to `.env` and provide:
   - `NVIDIA_NIM_API_KEY`
   - `DATABASE_URL` (PostgreSQL)

3. **Database Initialization**
   Run the SQL found in `src/storage/schema.sql` against your Postgres instance.

4. **Development**
   ```bash
   npm run dev
   ```

---

## Advanced Configuration

The system uses a centralized model control registry located at `src/config/modelControl.ts`. 

- **Central Source of Truth:** Add your models to the `MODELS` object and map them to specific agents in the `AGENT_MODEL_MAPPING`.
- **Optimization Strategy:** By default, the system uses a fast model (e.g., Llama 3.1 8B) for parallel facets and HTML rendering, and a heavy-reasoning model (e.g., Llama 3.1 70B) for deep architectural design and PRD synthesis.
- **Time Budgets:** You can control the maximum execution time via `.env` variables like `MARKET_PULSE_BUDGET_MS` (global) and `SPEC_FORGE_NODE_TIMEOUT_MS` (per-node) to ensure slow models don't cause the system to hang indefinitely.
