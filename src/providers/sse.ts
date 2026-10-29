/**
 * Incrementally parse SSE lines from a byte stream.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trimStart();
        if (payload === "[DONE]") {
          return;
        }
        onData(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function extractOpenAiDelta(jsonLine: string): string | undefined {
  try {
    const parsed = JSON.parse(jsonLine) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content;
  } catch {
    return undefined;
  }
}

export function extractAnthropicDelta(jsonLine: string): string | undefined {
  try {
    const parsed = JSON.parse(jsonLine) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      return parsed.delta.text;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
