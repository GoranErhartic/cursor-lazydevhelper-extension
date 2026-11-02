import { describe, expect, it } from "vitest";
import { LOADING_LINES, LOADING_LINE_HOLD_MS } from "../src/ui/loadingLines";

describe("loading lines", () => {
  it("has at least 500 lines", () => {
    expect(LOADING_LINES.length).toBeGreaterThanOrEqual(500);
  });

  it("has unique, non-empty, script-safe lines", () => {
    expect(new Set(LOADING_LINES).size).toBe(LOADING_LINES.length);
    for (const line of LOADING_LINES) {
      expect(line.trim()).toBe(line);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/[<>]/);
    }
  });

  it("holds each line for 10 seconds", () => {
    expect(LOADING_LINE_HOLD_MS).toBe(10_000);
  });
});
