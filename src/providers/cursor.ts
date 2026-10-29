import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId } from "../config/settings";
import { LlmProvider, ProviderError, StreamRequest } from "./Provider";
import { redactSecrets } from "./httpUtils";
import type { Agent, Cursor } from "@cursor/sdk";

type CursorSdk = { Agent: typeof Agent; Cursor: typeof Cursor };

/**
 * Loaded lazily (and kept external to the bundle) so the extension activates
 * even if the SDK or its native binary cannot be loaded.
 */
async function loadSdk(): Promise<CursorSdk> {
  // Keep runtime `require()` dynamic so bundling doesn't inline SDK internals.
  const runtimeRequire = require as NodeRequire;
  try {
    return runtimeRequire("@cursor/sdk") as CursorSdk;
  } catch {
    try {
      return runtimeRequire("../vendor/cursor-sdk") as CursorSdk;
    } catch {
      throw new ProviderError(
        "Cursor SDK is unavailable in this build. Reinstall dependencies and rebuild the extension.",
        "api"
      );
    }
  }
}

export function mapCursorError(err: unknown, apiKey: string): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }
  const e = err as { message?: string; status?: number; isRetryable?: boolean; name?: string };
  const message = redactSecrets(e?.message ?? String(err), apiKey);
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status === 401 || status === 403 || /unauthor|invalid.*(api )?key|authentication/i.test(message)) {
    return new ProviderError(
      "Invalid API key. Reconfigure your key in LazyDev AI settings.",
      "invalid_key",
      status
    );
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return new ProviderError("Rate limit exceeded. Try again shortly.", "rate_limit", status);
  }
  if (e?.name === "AbortError") {
    return new ProviderError("Request aborted.", "aborted");
  }
  return new ProviderError(message || "Cursor request failed.", "api", status);
}

function toPrompt(request: StreamRequest): string {
  return request.messages
    .map((m) => (m.role === "system" ? `Instructions:\n${m.content}` : m.content))
    .join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = normalizeText(value);
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstText(item);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const fields = ["summary", "title", "label", "status", "message", "text", "content", "reasoning", "thought"];
  for (const field of fields) {
    const text = firstText(record[field]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function pickTextByFields(
  record: Record<string, unknown>,
  fields: string[],
  maxDepth = 3
): string | undefined {
  for (const field of fields) {
    const direct = firstText(record[field]);
    if (direct) {
      return direct;
    }
  }
  if (maxDepth <= 0) {
    return undefined;
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = asRecord(item);
        if (!nested) {
          continue;
        }
        const text = pickTextByFields(nested, fields, maxDepth - 1);
        if (text) {
          return text;
        }
      }
      continue;
    }
    const nested = asRecord(value);
    if (!nested) {
      continue;
    }
    const text = pickTextByFields(nested, fields, maxDepth - 1);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function statusFromCursorEvent(event: unknown): string | undefined {
  const record = asRecord(event);
  if (!record) {
    return undefined;
  }
  const type = typeof record.type === "string" ? record.type : undefined;
  if (!type || type === "assistant" || type === "usage") {
    return undefined;
  }

  if (type === "tool_call") {
    const toolFields = ["toolName", "name", "tool", "title", "label"];
    const statusFields = ["status", "state", "phase", "result"];
    const toolName = pickTextByFields(record, toolFields, 4);
    const toolStatus = pickTextByFields(record, statusFields, 3);
    if (toolName && toolStatus) {
      return `tool ${toolName}: ${toolStatus}`;
    }
    if (toolName) {
      return `tool ${toolName}`;
    }
  }

  const detail = pickTextByFields(
    record,
    [
      "step",
      "title",
      "message",
      "summary",
      "details",
      "reasoning",
      "thought",
      "event",
      "delta",
      "status",
      "state",
      "phase",
      "result",
    ],
    4
  );
  if (detail) {
    const lower = detail.toLowerCase();
    // Suppress low-signal updates that only repeat lifecycle state.
    if (["running", "finished", "completed", "ok", "success"].includes(lower)) {
      return type === "status" ? detail : undefined;
    }
    return `${type}: ${detail}`;
  }

  if (type === "thinking" || type === "status") {
    return undefined;
  }
  return type;
}

export class CursorProvider implements LlmProvider {
  readonly id: ProviderId = "cursor";
  readonly displayName = "Cursor";

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<void> {
    await this.listModels(apiKey, signal);
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    try {
      const { Cursor } = await loadSdk();
      const models = await Cursor.models.list({ apiKey });
      if (signal?.aborted) {
        throw new ProviderError("Request aborted.", "aborted");
      }
      return models.map((m) => m.id).sort((a, b) => a.localeCompare(b));
    } catch (err) {
      throw mapCursorError(err, apiKey);
    }
  }

  async stream(
    request: StreamRequest,
    apiKey: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    onStatus?: (status: string) => void
  ): Promise<void> {
    // Isolated empty working dir: the agent never sees or touches the user's workspace.
    const cwd = await mkdtemp(join(tmpdir(), "lazydev-cursor-"));
    try {
      const { Agent } = await loadSdk();
      const agent = await Agent.create({
        apiKey,
        model: { id: request.model },
        local: { cwd, settingSources: [] },
      });
      try {
        const run = await agent.send(toPrompt(request), { mode: "plan" });
        const onAbort = (): void => {
          void run.cancel?.();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          for await (const event of run.stream()) {
            if (signal?.aborted) {
              break;
            }
            const status = statusFromCursorEvent(event);
            if (status) {
              onStatus?.(`Thinking… ${status}`);
            }
            if (event.type === "assistant") {
              for (const block of event.message.content) {
                if (block.type === "text") {
                  onChunk(block.text);
                }
              }
            }
          }
          const result = await run.wait();
          if (result.status === "error") {
            throw new ProviderError("Cursor run failed.", "api");
          }
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    } catch (err) {
      throw mapCursorError(err, apiKey);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
