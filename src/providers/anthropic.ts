import type { ProviderId } from "../config/settings";
import { LlmProvider, ProviderError, StreamRequest } from "./Provider";
import {
  consumeSseStream,
  extractAnthropicDelta,
} from "./sse";
import { ensureHttps, mapHttpToProviderError, readErrorBody } from "./httpUtils";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

function filterAnthropicModels(ids: string[]): string[] {
  return ids
    .filter((id) => id.includes("claude"))
    .sort((a, b) => a.localeCompare(b));
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly id: ProviderId = "anthropic";
  readonly displayName = "Anthropic";

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<void> {
    ensureHttps(ANTHROPIC_BASE);
    const response = await fetch(`${ANTHROPIC_BASE}/models`, {
      method: "GET",
      headers: anthropicHeaders(apiKey),
      signal,
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    ensureHttps(ANTHROPIC_BASE);
    const response = await fetch(`${ANTHROPIC_BASE}/models`, {
      method: "GET",
      headers: anthropicHeaders(apiKey),
      signal,
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const filtered = filterAnthropicModels(ids);
    return filtered.length > 0 ? filtered : ids.sort((a, b) => a.localeCompare(b));
  }

  async stream(
    request: StreamRequest,
    apiKey: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    _onStatus?: (status: string) => void
  ): Promise<void> {
    ensureHttps(ANTHROPIC_BASE);
    const systemParts = request.messages.filter((m) => m.role === "system");
    const nonSystem = request.messages.filter((m) => m.role !== "system");
    const system = systemParts.map((m) => m.content).join("\n\n");

    const response = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: "POST",
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        system: system || undefined,
        messages: nonSystem.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      }),
      signal,
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }

    if (!response.body) {
      throw new ProviderError("Empty response body from Anthropic.", "api");
    }

    await consumeSseStream(
      response.body,
      (jsonLine) => {
        const delta = extractAnthropicDelta(jsonLine);
        if (delta) {
          onChunk(delta);
        }
      },
      signal
    );
  }
}
