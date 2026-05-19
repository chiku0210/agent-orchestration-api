# agent-orchestration-api

Backend API for a multi-agent orchestration system. Built to explore two real orchestration patterns — handoff and fan-out/fan-in — with persistent agent memory backed by PostgreSQL and LLM inference via Groq.

This is not a framework wrapper. It's a from-scratch implementation of agent coordination patterns in Node.js.

**Live demo:** [multi-agent-showcase.nielless.com](https://multi-agent-showcase.nielless.com)
**Frontend repo:** [agent-orchestration-web](https://github.com/chiku0210/agent-orchestration-web)

---

## What it does

Two agents. Two ways to coordinate them.

**Handoff pattern** — Agent A completes its task, passes structured context to Agent B, and B picks up from there. Sequential, predictable, easy to trace. Good for pipelines where order matters.

**Fan-out / Fan-in pattern** — A task is dispatched to N agents simultaneously via `Promise.all`. All agents run in parallel, results are collected and aggregated once every agent resolves. Good for tasks that can be parallelised — research, multi-perspective analysis, etc.

The key design decision: agents share state via PostgreSQL. Each agent reads from and writes to a shared memory table, so context persists across sessions and agents don't operate blind to what others have done. Without this, you don't have a multi-agent system — you have multiple isolated LLM calls.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js (ESM) |
| Language | TypeScript |
| Framework | Express v5 |
| LLM Inference | Groq SDK (Llama3) |
| Database | PostgreSQL (via `pg`) |
| Validation | Zod |
| Dev tooling | tsx, nodemon, tsc |

---

## Project Structure

```
agent-orchestration-api/
├── src/
│   ├── agents/          # Individual agent definitions and system prompts
│   ├── orchestration/   # Handoff and fan-out/fan-in orchestration logic
│   ├── memory/          # PostgreSQL-backed shared memory layer
│   ├── routes/          # Express route handlers
│   └── index.ts         # Entry point
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL instance (local or hosted — Neon works)
- Groq API key ([get one here](https://console.groq.com))

### Installation

```bash
git clone https://github.com/chiku0210/agent-orchestration-api.git
cd agent-orchestration-api
npm install
```

### Environment Setup

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
PORT=8080
DATABASE_URL=postgresql://user:password@host:5432/dbname
GROQ_API_KEY=your_groq_api_key
```

### Run in development

```bash
npm run dev
```

### Build and run in production

```bash
npm run build
npm start
```

---

## API Endpoints

### `POST /api/orchestrate/handoff`

Runs the handoff pattern — Agent A → Agent B sequentially.

**Request body:**
```json
{
  "input": "string",
  "sessionId": "string"
}
```

**Response:**
```json
{
  "agentA": { "output": "string" },
  "agentB": { "output": "string" },
  "sessionId": "string"
}
```

---

### `POST /api/orchestrate/fanout`

Runs the fan-out/fan-in pattern — dispatches to multiple agents in parallel, aggregates results.

**Request body:**
```json
{
  "input": "string",
  "sessionId": "string"
}
```

**Response:**
```json
{
  "results": ["string", "string"],
  "aggregated": "string",
  "sessionId": "string"
}
```

---

### `GET /api/memory/:sessionId`

Returns the full shared memory state for a given session.

---

## How the memory layer works

Agents don't carry their own state. Instead, every read and write goes through a shared PostgreSQL table keyed by `sessionId`. Before any agent runs, it reads the current memory state for that session. After it completes, it writes its output back.

This means:
- Agent B in a handoff knows exactly what Agent A did
- In fan-out, aggregation can reference all agent outputs from a single DB read
- Context persists across API calls — you can resume a session

---

## Orchestration patterns in code

**Handoff:**
```typescript
const outputA = await agentA.run(input, sessionId);
await memory.write(sessionId, { agentA: outputA });

const outputB = await agentB.run(outputA, sessionId);
await memory.write(sessionId, { agentB: outputB });
```

**Fan-out / Fan-in:**
```typescript
const [outputA, outputB] = await Promise.all([
  agentA.run(input, sessionId),
  agentB.run(input, sessionId),
]);

const aggregated = await aggregator.run({ outputA, outputB }, sessionId);
await memory.write(sessionId, { outputA, outputB, aggregated });
```

---

## Deployment

Deployed on [Render](https://render.com). Set the environment variables in your Render service dashboard and point the build command to `npm run build` and start command to `npm start`.

---

## What I'd build next

- Dynamic agent count on fan-out
- Agent retry logic with exponential backoff on Groq timeouts
- Memory TTL / cleanup for old sessions
- Streaming responses for long-running agent tasks
- Webhook support for async orchestration jobs
