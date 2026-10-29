import { describe, expect, it } from "vitest";
import { buildMessages, extractFirstCodeBlock } from "../src/actions/prompts";
import { extractAnthropicDelta, extractOpenAiDelta } from "../src/providers/sse";
import { redactSecrets } from "../src/providers/httpUtils";
import { mapCursorError } from "../src/providers/cursor";

describe("buildMessages", () => {
  it("includes file and code for analyze", () => {
    const { system, user } = buildMessages("analyze", {
      languageId: "typescript",
      fileName: "src/a.ts",
      code: "const x = 1;",
    });
    expect(system).toContain("software engineer");
    expect(user).toContain("src/a.ts");
    expect(user).toContain("const x = 1;");
  });
});

describe("extractFirstCodeBlock", () => {
  it("extracts fenced block", () => {
    const out = extractFirstCodeBlock("```typescript\nconst a = 1;\n```", "typescript");
    expect(out).toBe("const a = 1;");
  });
});

describe("sse deltas", () => {
  it("parses openai chunk", () => {
    const json = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    expect(extractOpenAiDelta(json)).toBe("hi");
  });

  it("parses anthropic chunk", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello" },
    });
    expect(extractAnthropicDelta(json)).toBe("hello");
  });
});

describe("redactSecrets", () => {
  it("redacts api key substring", () => {
    const key = "sk-testkey1234567890";
    expect(redactSecrets(`Error: ${key}`, key)).not.toContain(key);
  });
});

describe("cursor provider", () => {
  it("redacts cursor keys", () => {
    expect(redactSecrets("key cursor_abcdefgh12345", undefined)).toContain("REDACTED:CURSOR_KEY");
  });

  it("maps auth errors to invalid_key", () => {
    expect(mapCursorError({ message: "Unauthorized", status: 401 }, "k").code).toBe("invalid_key");
  });

  it("maps rate limits", () => {
    expect(mapCursorError({ message: "slow down", status: 429 }, "k").code).toBe("rate_limit");
  });
});
