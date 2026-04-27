import { z } from "zod";
import Groq from "groq-sdk";
import { throttleCompoundIfNeeded } from "./groqThrottle.js";

type RunParams<T> = {
  systemPrompt: string;
  userPrompt: string;
  schema?: z.ZodSchema<T>;
};

const MAX_PARSE_RETRIES = 2;
const MAX_429_RETRIES = 10;

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

function isGroqJsonValidateFailedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    status?: number;
    error?: { error?: { code?: string; type?: string } };
  };
  if (anyErr.status !== 400) return false;
  const code = anyErr.error?.error?.code;
  return code === "json_validate_failed";
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

export class AgentRunner {
  private readonly model: string;
  private readonly groq: Groq;

  constructor(model: string) {
    this.model = model;
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async run(params: { systemPrompt: string; userPrompt: string }): Promise<string>;
  async run<T>(params: RunParams<T> & { schema: z.ZodSchema<T> }): Promise<T>;
  async run<T>(params: RunParams<T>): Promise<T | string> {
    const { systemPrompt, schema } = params;
    let userPrompt = params.userPrompt;
    const forceJson = Boolean(schema);
    const baseStructuredSystemPrompt = forceJson
      ? `${systemPrompt}\n\nReturn ONLY valid JSON. Do not wrap in markdown.`
      : systemPrompt;
    let systemPromptForAttempt = baseStructuredSystemPrompt;

    for (let parseAttempt = 0; parseAttempt <= MAX_PARSE_RETRIES; parseAttempt++) {
      const content = await this.completeChatWith429Backoff(systemPromptForAttempt, userPrompt, forceJson);
      if (!schema) return content;
      try {
        const parsed = parseModelJsonResponse(content);
        return schema.parse(parsed);
      } catch (err) {
        const recoverable = err instanceof z.ZodError || err instanceof SyntaxError;
        if (recoverable && parseAttempt < MAX_PARSE_RETRIES) {
          // Ask the model to repair its previous output into valid JSON matching the schema.
          // Keep this generic so it works for all agents using schemas.
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
          // Some models ignore the original role prompt during repair and emit reasoning.
          // Switch to a dedicated repair prompt to strongly constrain format.
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
  ): Promise<string> {
    // If Groq rejects `response_format: json_object` (400 json_validate_failed),
    // fall back to "loose" JSON and parse locally.
    let useResponseFormat = forceJson;

    for (let apiAttempt = 0; apiAttempt < MAX_429_RETRIES; apiAttempt++) {
      try {
        await throttleCompoundIfNeeded(this.model);
        const completion = await this.groq.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
          ],
          ...(useResponseFormat ? { response_format: { type: "json_object" as const } } : {}),
        });
        return completion.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        if (useResponseFormat && isGroqJsonValidateFailedError(err)) {
          useResponseFormat = false;
          // Tiny jitter to avoid immediately repeating identical failures.
          await sleep(150 + Math.floor(Math.random() * 250));
          continue;
        }
        if (isRateLimitError(err) && apiAttempt < MAX_429_RETRIES - 1) {
          const fromHeader = getRetryAfterMsFromError(err);
          const backoff = fromHeader ?? Math.min(2_000 * 2 ** apiAttempt, 60_000);
          const jitter = Math.floor(Math.random() * 500);
          await sleep(backoff + jitter);
          continue;
        }
        if (isRequestTooLargeError(err) && apiAttempt < MAX_429_RETRIES - 1) {
          // Transient 413; retry (primary mitigation is not using `groq/compound` for facets)
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
