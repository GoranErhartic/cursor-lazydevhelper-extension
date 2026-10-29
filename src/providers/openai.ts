import type { ProviderId } from "../config/settings";
import { LlmProvider, ProviderError, StreamRequest } from "./Provider";
import {
  consumeSseStream,
  extractOpenAiDelta,
} from "./sse";
import { ensureHttps, mapHttpToProviderError, readErrorBody } from "./httpUtils";

const OPENAI_BASE = "https://api.openai.com/v1";

function filterOpenAiModels(ids: string[]): string[] {
  return ids
    .filter((id) => !id.includes("embedding") && !id.includes("tts") && !id.includes("whisper"))
    .filter((id) => id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"))
    .sort((a, b) => a.localeCompare(b));
}

export class OpenAiProvider implements LlmProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "OpenAI";

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<void> {
    ensureHttps(OPENAI_BASE);
    const response = await fetch(`${OPENAI_BASE}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
    ensureHttps(OPENAI_BASE);
    const response = await fetch(`${OPENAI_BASE}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const filtered = filterOpenAiModels(ids);
    return filtered.length > 0 ? filtered : ids.sort((a, b) => a.localeCompare(b));
  }

  async stream(
    request: StreamRequest,
    apiKey: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    _onStatus?: (status: string) => void
  ): Promise<void> {
    ensureHttps(OPENAI_BASE);
    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        max_tokens: request.maxTokens ?? 4096,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw await mapHttpToProviderError(response.status, body, apiKey);
    }

    if (!response.body) {
      throw new ProviderError("Empty response body from OpenAI.", "api");
    }

    await consumeSseStream(
      response.body,
      (jsonLine) => {
        const delta = extractOpenAiDelta(jsonLine);
        if (delta) {
          onChunk(delta);
        }
      },
      signal
    );
  }
}
