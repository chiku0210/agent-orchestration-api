import "dotenv/config";
import express from "express";
import { z } from "zod";

import { runEventBus } from "./orchestrator/eventBus.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { getLatestSucceededMarketPulseRunId } from "./storage/runs.js";

const app = express();

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

app.get("/v1/runs/:runId/events", (req, res) => {
  const { runId } = req.params;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Initial event so clients know the stream is open.
  res.write(`: connected\n\n`);

  const handler = (payload: { runId: string; event: unknown }) => {
    // SSE message: one JSON-encoded RunEvent per message
    res.write(`data: ${JSON.stringify(payload.event)}\n\n`);
  };

  runEventBus.on(runId, handler);

  req.on("close", () => {
    runEventBus.off(runId, handler);
  });
});

const port = 8080;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-orchestration-api listening on :${port}`);
});
