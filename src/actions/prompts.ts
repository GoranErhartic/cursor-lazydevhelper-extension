export type ActionKind = "analyze" | "review" | "simplify";

export type PromptContext = {
  languageId: string;
  fileName: string;
  code: string;
};

export function buildMessages(
  action: ActionKind,
  ctx: PromptContext
): { system: string; user: string } {
  const fileHint = `File: ${ctx.fileName} (${ctx.languageId})`;

  switch (action) {
    case "analyze":
      return {
        system: [
          "You are a senior software engineer helping a developer understand a code selection.",
          "Explain what the code does, note complexity, important dependencies, and edge cases.",
          "Use clear markdown headings and bullet lists. Do not invent behavior not present in the code.",
        ].join(" "),
        user: `${fileHint}\n\n\`\`\`${ctx.languageId}\n${ctx.code}\n\`\`\``,
      };
    case "review":
      return {
        system: [
          "You are a thorough code reviewer.",
          "Find bugs, security issues, correctness problems, and maintainability concerns.",
          "Group findings by severity (critical, major, minor). Be specific and reference the code.",
          "If the snippet looks fine, say so briefly.",
        ].join(" "),
        user: `${fileHint}\n\n\`\`\`${ctx.languageId}\n${ctx.code}\n\`\`\``,
      };
    case "simplify":
      return {
        system: [
          "You refactor code to be simpler and clearer while preserving behavior.",
          "Respond with exactly one fenced code block containing the simplified code.",
          "Use the same language as the input. No prose outside the code block.",
        ].join(" "),
        user: `${fileHint}\n\n\`\`\`${ctx.languageId}\n${ctx.code}\n\`\`\``,
      };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function actionTitle(action: ActionKind): string {
  switch (action) {
    case "analyze":
      return "Analyze Code";
    case "review":
      return "Review Code";
    case "simplify":
      return "Simplify Code";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Extract the first fenced code block from model output (for simplify apply).
 */
export function extractFirstCodeBlock(text: string, languageId?: string): string | undefined {
  const fence = languageId ? `\`\`\`${languageId}` : "```";
  const start = text.indexOf(fence);
  const genericStart = start >= 0 ? start : text.indexOf("```");
  if (genericStart < 0) {
    return undefined;
  }
  const afterFence = text.indexOf("\n", genericStart);
  if (afterFence < 0) {
    return undefined;
  }
  const end = text.indexOf("```", afterFence + 1);
  if (end < 0) {
    return text.slice(afterFence + 1).trim();
  }
  return text.slice(afterFence + 1, end).trim();
}
