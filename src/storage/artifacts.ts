import { randomUUID } from "node:crypto";

import type { FileBundleItem, MarketPulsePackage, SpecForgeHtmlArtifact } from "../contracts/index.js";
import { MarketPulsePackageSchema } from "../contracts/marketPulsePackage.zod.js";
import { pool } from "./db.js";

function sanitizeForJsonb(value: unknown): unknown {
  if (typeof value === "string") {
    // Postgres rejects JSON strings containing NUL bytes.
    return value.replace(/\u0000/g, "");
  }
  if (Array.isArray(value)) return value.map(sanitizeForJsonb);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeForJsonb(v);
    return out;
  }
  return value;
}

export async function saveArtifact(runId: string, kind: string, content: unknown): Promise<string> {
  const id = randomUUID();
  const json = JSON.stringify(sanitizeForJsonb(content));
  await pool.query(`insert into artifacts (id, run_id, kind, content) values ($1, $2, $3, $4::jsonb)`, [
    id,
    runId,
    kind,
    json,
  ]);
  return id;
}

export async function saveMarketPulsePackageArtifact(runId: string, pkg: MarketPulsePackage): Promise<string> {
  return saveArtifact(runId, "market_pulse_package", pkg);
}

export async function getMarketPulsePackageBySourceRunId(mpRunId: string): Promise<MarketPulsePackage | null> {
  const r = await pool.query<{ content: unknown }>(
    `select content from artifacts where run_id = $1 and kind = $2 order by created_at desc limit 1`,
    [mpRunId, "market_pulse_package"],
  );
  const row = r.rows[0];
  if (!row) return null;
  const parsed = MarketPulsePackageSchema.safeParse(row.content);
  return parsed.success ? parsed.data : null;
}

export async function saveFileBundleArtifact(runId: string, bundle: FileBundleItem[]): Promise<string> {
  return saveArtifact(runId, "file_bundle", bundle);
}

export async function saveSpecForgeHtmlArtifact(runId: string, artifact: SpecForgeHtmlArtifact): Promise<string> {
  return saveArtifact(runId, "spec_forge_html", artifact);
}

export async function getLatestSpecForgeHtmlArtifact(runId: string): Promise<SpecForgeHtmlArtifact | null> {
  const r = await pool.query<{ content: unknown }>(
    `select content from artifacts where run_id = $1 and kind = $2 order by created_at desc limit 1`,
    [runId, "spec_forge_html"],
  );
  const row = r.rows[0];
  if (!row || !row.content || typeof row.content !== "object") return null;
  const o = row.content as Record<string, unknown>;
  if (typeof o.summary !== "string" || typeof o.html !== "string") return null;
  return { summary: o.summary, html: o.html };
}
