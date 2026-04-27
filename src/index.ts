import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";

import { runEventBus } from "./orchestrator/eventBus.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { getLatestSucceededMarketPulseRunId } from "./storage/runs.js";
import { getLatestSpecForgeHtmlArtifact, getMarketPulsePackageBySourceRunId } from "./storage/artifacts.js";
import { pool } from "./storage/db.js";

const app = express();

app.set("trust proxy", 1);

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Default dev origin so local web can hit local API without extra setup.
  if (process.env.NODE_ENV !== "production") {
    fromEnv.push("http://localhost:3000");
  }

  return Array.from(new Set(fromEnv));
}

const corsOrigins = parseCorsOrigins();

app.use(
  cors({
    origin:
      corsOrigins.length > 0
        ? corsOrigins
        : // If no origins configured, be permissive in non-prod, strict in prod.
          process.env.NODE_ENV === "production"
          ? false
          : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
// Express v5 doesn't accept "*" here (path-to-regexp); use a regex for preflight.
app.options(/.*/, cors());

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

const CreateRunBodySchema = z
  .object({
    workflow: z.enum(["market_pulse", "spec_forge"]),
    prompt: z.string().min(1),
    marketPulseRunId: z.string().optional(),
  })
  .superRefine((_data, _ctx) => {
    // Note: we no longer hard-reject missing marketPulseRunId for spec_forge.
    // The handler will attempt a best-effort fallback to the latest succeeded MarketPulse run.
  });

app.post("/v1/runs", async (req, res) => {
  const parsed = CreateRunBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const orchestrator = new Orchestrator();
  const inferredMarketPulseRunId =
    parsed.data.workflow === "spec_forge" && !parsed.data.marketPulseRunId
      ? await getLatestSucceededMarketPulseRunId()
      : null;

  const marketPulseRunIdFinal =
    parsed.data.workflow === "spec_forge" ? (parsed.data.marketPulseRunId ?? inferredMarketPulseRunId ?? undefined) : undefined;

  if (parsed.data.workflow === "spec_forge" && !parsed.data.marketPulseRunId && !inferredMarketPulseRunId) {
    res.status(400).json({
      error: "invalid_request",
      details: {
        message:
          "marketPulseRunId is required for spec_forge (no succeeded MarketPulse run found to infer from)",
      },
    });
    return;
  }
  const { runId } = await orchestrator.createRun({
    workflow: parsed.data.workflow,
    inputPrompt: parsed.data.prompt,
    ...(marketPulseRunIdFinal ? { marketPulseRunId: marketPulseRunIdFinal } : {}),
  });

  // Immediately return the runId to the client.
  res.status(201).json({ runId });

  // Trigger execution in the background (non-blocking).
  void orchestrator.executeRun(runId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("executeRun failed", { runId, err });
  });
});

app.get("/v1/runs/:runId/events", async (req, res) => {
  const { runId } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform", // 'no-transform' tells Cloudflare not to compress/alter the stream
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // CRITICAL: Tells Render's Nginx proxy to stop buffering and stream instantly
    "Access-Control-Allow-Origin": process.env.CORS_ORIGINS || "*", // Ensure CORS is maintained here
  });

  // Immediately flush the headers so the client knows the connection is established
  res.flushHeaders();

  // Keep-alive heartbeat for Cloudflare
  const heartbeat = setInterval(() => {
    res.write(":\n\n"); // A colon indicates an SSE comment. It does nothing but keep the pipe open.
  }, 15000);

  // Initial event so clients know the stream is open.
  res.write(`: connected\n\n`);

  // Durability: replay persisted events so late subscribers still see `run_finished`
  // (and can auto-fetch artifacts) even if the in-memory emitter already fired.
  try {
    const r = await pool.query<{ payload: unknown }>(
      `select payload from events where run_id = $1 order by created_at asc`,
      [runId],
    );
    for (const row of r.rows) {
      res.write(`data: ${JSON.stringify(row.payload)}\n\n`);
    }
    res.write(`: replay_done\n\n`);
  } catch (err) {
    // If replay fails, keep live-streaming; the client can still fetch on-demand.
    res.write(`: replay_failed ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
  }

  const handler = (payload: { runId: string; event: unknown }) => {
    // SSE message: one JSON-encoded RunEvent per message
    res.write(`data: ${JSON.stringify(payload.event)}\n\n`);
  };

  runEventBus.on(runId, handler);

  req.on("close", () => {
    clearInterval(heartbeat);
    runEventBus.off(runId, handler);
  });
});

app.get("/v1/runs/:runId/spec-forge-html", async (req, res) => {
  const { runId } = req.params;
  const artifact = await getLatestSpecForgeHtmlArtifact(runId);
  if (!artifact) {
    res.status(404).json({ error: "not_found", details: { message: "spec_forge_html artifact not found for run" } });
    return;
  }
  res.status(200).json(artifact);
});

// Back-compat endpoint used by the web UI for auto-fetch after `run_finished`.
// Returns a minimal SpecForgeArtifacts shape (HTML-only mode) plus the MarketPulse package if present.
app.get("/v1/runs/:runId/artifacts", async (req, res) => {
  const { runId } = req.params;

  const [marketPulsePackage, specForgeHtml] = await Promise.all([
    getMarketPulsePackageBySourceRunId(runId),
    getLatestSpecForgeHtmlArtifact(runId),
  ]);

  // HTML-only mode: the backend persists a `spec_forge_html` artifact, but the web contract
  // expects a `specForgeArtifacts.output.html` field. Provide a minimal compatible object.
  const specForgeArtifacts =
    specForgeHtml == null
      ? undefined
      : {
          version: 1 as const,
          runId,
          createdAt: Date.now(),
          marketPulseRunId: runId,
          prd: { problemStatement: "", users: [], userStories: [], acceptanceCriteria: [], outOfScope: [] },
          architecture: { overview: "", apiContracts: [], dataModelNotes: [], fileStructure: [] },
          db: { sqlMigrations: [], notes: [] },
          backend: { notes: [] },
          frontend: { notes: [] },
          risks: [],
          taskPlan: [],
          output: { html: specForgeHtml.html, summary: specForgeHtml.summary },
        };

  if (!marketPulsePackage && !specForgeArtifacts) {
    res.status(404).json({ error: "not_found", details: { message: "no artifacts found for run" } });
    return;
  }

  res.status(200).json({
    marketPulsePackage: marketPulsePackage ?? undefined,
    specForgeArtifacts,
  });
});

app.get("/v1/runs/latest/artifacts", async (_req, res) => {
  const runId = await getLatestSucceededMarketPulseRunId();
  if (!runId) {
    res.status(404).json({ error: "not_found", details: { message: "no succeeded market_pulse runs found" } });
    return;
  }

  const marketPulsePackage = await getMarketPulsePackageBySourceRunId(runId);
  const specForgeHtml = await getLatestSpecForgeHtmlArtifact(runId);

  res.status(200).json({
    runId,
    marketPulsePackage: marketPulsePackage ?? undefined,
    specForgeHtml: specForgeHtml ?? undefined,
  });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-orchestration-api listening on :${port}`);
});
