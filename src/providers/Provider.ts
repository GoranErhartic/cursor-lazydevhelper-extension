export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
};

export type ProviderErrorCode = "invalid_key" | "rate_limit" | "network" | "api" | "aborted";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: ProviderErrorCode,
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface LlmProvider {
  readonly id: import("../config/settings").ProviderId;
  readonly displayName: string;
  validateKey(apiKey: string, signal?: AbortSignal): Promise<void>;
  listModels(apiKey: string, signal?: AbortSignal): Promise<string[]>;
  stream(
    request: StreamRequest,
    apiKey: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    onStatus?: (status: string) => void
  ): Promise<void>;
}
