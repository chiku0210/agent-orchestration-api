import { z } from "zod";
import OpenAI from "openai";
import { throttleNIMIfNeeded } from "./nimThrottle.js";

type RunParams<T> = {
  systemPrompt: string;
  userPrompt: string;
  schema?: z.ZodSchema<T>;
  maxTokens?: number;
};

const MAX_PARSE_RETRIES = 2;
const MAX_429_RETRIES = 10;
const MAX_PARSE_RETRIES_CFG = Math.max(
  0,
  Number.parseInt(process.env.NIM_AGENT_MAX_PARSE_RETRIES ?? String(MAX_PARSE_RETRIES), 10) ||
    MAX_PARSE_RETRIES,
);
const MAX_429_RETRIES_CFG = Math.max(
  1,
  Number.parseInt(process.env.NIM_AGENT_MAX_429_RETRIES ?? String(MAX_429_RETRIES), 10) || MAX_429_RETRIES,
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { status?: number }).status === 429;
}

function isRequestTooLargeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { status?: number }).status === 413;
}

function getRetryAfterMsFromError(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const headers = (err as { headers?: { get?: (k: string) => string | null } }).headers;
  const raw = headers?.get?.("retry-after");
  if (raw) {
    const s = parseInt(String(raw), 10);
    if (!Number.isNaN(s) && s >= 0) return s * 1000;
  }
  return null;
}

function isBadRequestError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { status?: number }).status === 400;
}

export class AgentRunner {
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(model: string) {
    this.model = model;
    this.client = new OpenAI({
      apiKey: process.env.NVIDIA_NIM_API_KEY,
      baseURL: process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
    });
  }

  async run(params: { systemPrompt: string; userPrompt: string; maxTokens?: number }): Promise<string>;
  async run<T>(params: RunParams<T> & { schema: z.ZodSchema<T> }): Promise<T>;
  async run<T>(params: RunParams<T>): Promise<T | string> {
    const { systemPrompt, schema, maxTokens } = params;
    let userPrompt = params.userPrompt;
    const forceJson = Boolean(schema);
    const baseStructuredSystemPrompt = forceJson
      ? `${systemPrompt}\n\nReturn ONLY valid JSON. Do not wrap in markdown.`
      : systemPrompt;
    let systemPromptForAttempt = baseStructuredSystemPrompt;

    for (let parseAttempt = 0; parseAttempt <= MAX_PARSE_RETRIES_CFG; parseAttempt++) {
      const content = await this.completeChatWith429Backoff(
        systemPromptForAttempt,
        userPrompt,
        forceJson,
        maxTokens,
      );

      if (!schema) return content;

      try {
        const parsed = parseModelJsonResponse(content);
        return schema.parse(parsed);
      } catch (err) {
        if (err instanceof z.ZodError) {
          const safeRaw = content.length > 900 ? content.slice(0, 900) + "...<truncated>" : content;
          let safeParsed = "<unserializable>";
          try {
            const reparsed = parseModelJsonResponse(content);
            safeParsed = JSON.stringify(reparsed).slice(0, 1200);
          } catch {
            // ignore
          }
          // eslint-disable-next-line no-console
          console.error("AgentRunner schema validation failed", {
            issues: err.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
            parsedPreview: safeParsed,
            rawPreview: safeRaw,
          });
        }

        const recoverable = err instanceof z.ZodError || err instanceof SyntaxError;
        if (recoverable && parseAttempt < MAX_PARSE_RETRIES_CFG) {
          userPrompt = JSON.stringify({
            task: "repair_json_to_match_schema",
            originalUserPrompt: params.userPrompt,
            previousModelOutput: content,
            validationError:
              err instanceof z.ZodError
                ? err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code }))
                : err instanceof Error
                  ? err.message
                  : String(err),
            instructions: [
              "Return ONLY a corrected JSON object.",
              "It MUST validate against the required schema for this task.",
              "Do not omit required fields; fill them with best-effort plausible values grounded ONLY in originalUserPrompt.",
              "Do not add extra keys.",
              "Do not include any reasoning, preambles, or <think> tags.",
              "The first character of your response MUST be '{' and the last character MUST be '}'.",
            ],
          });
          systemPromptForAttempt = [
            "You are a strict JSON repair tool.",
            "Your ONLY job is to output a single JSON object that matches the required schema.",
            "Do NOT output any text other than the JSON object.",
            "Do NOT output <think> blocks, markdown, code fences, or explanations.",
          ].join("\n");
          continue;
        }

        throw err;
      }
    }

    throw new Error("AgentRunner: unexpected end");
  }

  private async completeChatWith429Backoff(
    systemContent: string,
    userContent: string,
    forceJson: boolean,
    maxTokens?: number,
  ): Promise<string> {
    // NVIDIA NIM supports standard chat completion params.
    let useResponseFormat = forceJson;

    for (let apiAttempt = 0; apiAttempt < MAX_429_RETRIES_CFG; apiAttempt++) {
      try {
        await throttleNIMIfNeeded(this.model);
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens ?? 4096,
          ...(useResponseFormat ? { response_format: { type: "json_object" as const } } : {}),
        });
        return completion.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        if (useResponseFormat && isBadRequestError(err)) {
          // If the model doesn't support json_object mode, fall back to normal text.
          useResponseFormat = false;
          await sleep(200 + Math.floor(Math.random() * 300));
          continue;
        }
        if (isRateLimitError(err) && apiAttempt < MAX_429_RETRIES_CFG - 1) {
          const fromHeader = getRetryAfterMsFromError(err);
          const backoff = fromHeader ?? Math.min(2_000 * 2 ** apiAttempt, 60_000);
          const jitter = Math.floor(Math.random() * 500);
          await sleep(backoff + jitter);
          continue;
        }
        if (isRequestTooLargeError(err) && apiAttempt < MAX_429_RETRIES_CFG - 1) {
          await sleep(2_000 + Math.floor(Math.random() * 1_000));
          continue;
        }
        throw err;
      }
    }
    throw new Error("AgentRunner: 429 retry exhausted");
  }
}

/**
 * Models sometimes return markdown or prose even with `json_object` / instructions.
 * Extract and parse the first JSON object or array, or fenced ```json``` block.
 */
function parseModelJsonResponse(raw: string): unknown {
  const strippedThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const text = strippedThink;
  if (!text) {
    throw new SyntaxError("Empty model response");
  }

  const candidates: string[] = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    candidates.push(fence[1]!.trim());
  }
  const o0 = text.indexOf("{");
  const o1 = text.lastIndexOf("}");
  if (o0 >= 0 && o1 > o0) {
    candidates.push(text.slice(o0, o1 + 1));
  }
  const a0 = text.indexOf("[");
  const a1 = text.lastIndexOf("]");
  if (a0 >= 0 && a1 > a0) {
    candidates.push(text.slice(a0, a1 + 1));
  }
  // As a last resort, try to grab a JSON-looking substring even if the model
  // added pre/post amble and braces don't span the full response cleanly.
  const greedyObject = text.match(/\{[\s\S]*\}/);
  if (greedyObject?.[0]) candidates.push(greedyObject[0]);
  const greedyArray = text.match(/\[[\s\S]*\]/);
  if (greedyArray?.[0]) candidates.push(greedyArray[0]);

  for (const c of candidates) {
    try {
      return JSON.parse(c) as unknown;
    } catch {
      // try next candidate
    }
  }
  throw new SyntaxError(`Could not parse JSON from model output: ${text.slice(0, 120)}`);
}
