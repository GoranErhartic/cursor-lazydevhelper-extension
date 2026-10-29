import * as vscode from "vscode";
import { ActionKind } from "../actions/prompts";
import { renderMarkdownToHtml } from "./markdown";

export type ApplyTarget = {
  uri: vscode.Uri;
  range: vscode.Range;
  documentVersion: number;
  languageId: string;
};

export type PanelOptions = {
  title: string;
  action: ActionKind;
  applyTarget?: ApplyTarget;
  onApply?: (fullText: string) => Promise<void>;
};

export class ResultPanel {
  private panel: vscode.WebviewPanel | undefined;
  private accumulated = "";
  private statusLine = "Ready";
  private abortHandler: (() => void) | undefined;
  private options: PanelOptions | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(options: PanelOptions): void {
    this.options = options;
    this.accumulated = "";
    this.statusLine = "Ready";
    this.abortHandler = undefined;

    if (this.panel) {
      this.panel.title = options.title;
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "lazydevResult",
        options.title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.accumulated = "";
      });
      this.panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
        if (msg.type === "copy") {
          await vscode.env.clipboard.writeText(this.accumulated);
          void vscode.window.showInformationMessage("LazyDev AI: Copied to clipboard.");
        }
        if (msg.type === "apply" && this.options?.onApply) {
          await this.options.onApply(this.accumulated);
        }
        if (msg.type === "cancel") {
          if (this.abortHandler) {
            this.abortHandler();
          } else {
            this.panel?.dispose();
          }
        }
      });
    }

    this.postFullUpdate();
  }

  setAbortHandler(handler: () => void): void {
    this.abortHandler = handler;
    this.postFullUpdate();
  }

  /** Call when the request has finished; Cancel then becomes Close. */
  clearAbortHandler(): void {
    this.abortHandler = undefined;
    this.postFullUpdate();
  }

  append(chunk: string): void {
    this.accumulated += chunk;
    this.postFullUpdate();
  }

  setStatus(status: string): void {
    this.statusLine = status;
    this.postFullUpdate();
  }

  private postFullUpdate(): void {
    if (!this.panel || !this.options) {
      return;
    }
    const nonce = getNonce();
    const showApply = this.options.action === "simplify" && Boolean(this.options.applyTarget);
    const hasContent = this.accumulated.trim().length > 0;
    const bodyHtml = hasContent
      ? renderMarkdownToHtml(this.accumulated)
      : this.abortHandler
        ? getLoadingHtml(this.options.action)
        : renderMarkdownToHtml("_No response generated._");

    this.panel.webview.html = getWebviewHtml({
      nonce,
      title: this.options.title,
      bodyHtml,
      loadingMessages: getLoadingMessages(this.options.action),
      statusLine: this.statusLine,
      showApply,
      running: Boolean(this.abortHandler),
    });
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getWebviewHtml(args: {
  nonce: string;
  title: string;
  bodyHtml: string;
  loadingMessages: string[];
  statusLine: string;
  showApply: boolean;
  running: boolean;
}): string {
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${args.nonce}'`,
    `script-src 'nonce-${args.nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeAttr(args.title)}</title>
  <style nonce="${args.nonce}">
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px 16px;
      line-height: 1.5;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px;
    }
    h1 { font-size: 1.1em; margin: 0; flex: 1; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 2px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .status { opacity: 0.8; font-size: 0.9em; width: 100%; }
    .loader {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      max-width: 420px;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
      border-top-color: var(--vscode-foreground);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      flex: 0 0 auto;
    }
    .loader-dots::after {
      content: "";
      animation: dots 1.2s steps(4, end) infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes dots {
      0% { content: ""; }
      25% { content: "."; }
      50% { content: ".."; }
      75% { content: "..."; }
      100% { content: ""; }
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      overflow-x: auto;
    }
    code { font-family: var(--vscode-editor-font-family); }
    ul { padding-left: 1.2em; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeAttr(args.title)}</h1>
    <button id="copy">Copy</button>
    ${args.showApply ? '<button id="apply">Apply to selection</button>' : ""}
    <button class="secondary" id="cancel">${args.running ? "Cancel" : "Close"}</button>
    <div class="status">${escapeAttr(args.statusLine)}</div>
  </header>
  <main>${args.bodyHtml}</main>
  <script nonce="${args.nonce}">
    const vscode = acquireVsCodeApi();
    const loadingMessages = ${JSON.stringify(args.loadingMessages)};
    document.getElementById("copy")?.addEventListener("click", () => vscode.postMessage({ type: "copy" }));
    document.getElementById("apply")?.addEventListener("click", () => vscode.postMessage({ type: "apply" }));
    document.getElementById("cancel")?.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
    const loadingEl = document.getElementById("loader-message");
    if (loadingEl && Array.isArray(loadingMessages) && loadingMessages.length > 1) {
      const now = Date.now();
      const state = vscode.getState() || {};
      const hasValidIndex =
        Number.isInteger(state.loaderIndex) &&
        state.loaderIndex >= 0 &&
        state.loaderIndex < loadingMessages.length;
      let index = hasValidIndex ? state.loaderIndex : Math.floor(Math.random() * loadingMessages.length);
      let nextSwitchAt = typeof state.nextSwitchAt === "number" ? state.nextSwitchAt : now + 2000;

      const pickNextIndex = () => {
        let next = index;
        while (next === index && loadingMessages.length > 1) {
          next = Math.floor(Math.random() * loadingMessages.length);
        }
        index = next;
      };

      if (now >= nextSwitchAt) {
        pickNextIndex();
        nextSwitchAt = now + 2000;
      }

      loadingEl.textContent = loadingMessages[index];
      vscode.setState({ loaderIndex: index, nextSwitchAt });

      const tick = () => {
        pickNextIndex();
        nextSwitchAt = Date.now() + 2000;
        loadingEl.textContent = loadingMessages[index];
        vscode.setState({ loaderIndex: index, nextSwitchAt });
      };
      setInterval(tick, 4500);
    }
  </script>
</body>
</html>`;
}

function getLoadingMessages(action: ActionKind): string[] {
  switch (action) {
    case "analyze": {
      return buildWittyLines(
        [
          "Scanning",
          "Tracing",
          "Mapping",
          "Unpacking",
          "Surveying",
          "Decoding",
          "Inspecting",
          "Following",
        ],
        [
          "code pathways",
          "logic branches",
          "control flow",
          "dependency clues",
          "edge cases",
          "intent signals",
          "runtime behavior hints",
          "complexity hotspots",
        ],
        [
          "with a magnifying glass",
          "one breadcrumb at a time",
          "without judging variable names",
          "before the coffee cools",
          "for your future self",
          "like a polite detective",
          "minus the dramatic soundtrack",
          "and taking tidy notes",
        ]
      );
    }
    case "review": {
      return buildWittyLines(
        [
          "Reviewing",
          "Probing",
          "Stress-testing",
          "Double-checking",
          "Hunting",
          "Auditing",
          "Cross-examining",
          "Verifying",
        ],
        [
          "bug magnets",
          "risky assumptions",
          "sharp corners",
          "security blind spots",
          "edge-case surprises",
          "maintainability traps",
          "correctness gaps",
          "readability potholes",
        ],
        [
          "with gentle skepticism",
          "before they reach production",
          "so future incidents stay fictional",
          "with kindness and precision",
          "while resisting nitpick overdrive",
          "without breaking your flow",
          "as your second pair of eyes",
          "and writing useful notes",
        ]
      );
    }
    case "simplify": {
      return buildWittyLines(
        [
          "Simplifying",
          "Refactoring",
          "Polishing",
          "Tidying",
          "Streamlining",
          "Untangling",
          "Smoothing",
          "Clarifying",
        ],
        [
          "busy code paths",
          "nested logic knots",
          "verbose patterns",
          "complex expressions",
          "hard-to-read sections",
          "repeat-heavy blocks",
          "naming rough edges",
          "cognitive overhead",
        ],
        [
          "into cleaner shape",
          "without changing behavior",
          "for kinder maintenance days",
          "one neat pass at a time",
          "so intent is obvious",
          "with fewer brain cycles",
          "for maximum clarity points",
          "and less future confusion",
        ]
      );
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function getLoadingHtml(action: ActionKind): string {
  const first = escapeAttr(getLoadingMessages(action)[0] ?? "Waiting for response");
  return `<div class="loader"><div class="spinner" aria-hidden="true"></div><div><strong id="loader-message">${first}</strong><span class="loader-dots"></span></div></div>`;
}

function buildWittyLines(starts: string[], middles: string[], endings: string[]): string[] {
  const lines: string[] = [];
  for (const start of starts) {
    for (const middle of middles) {
      for (const ending of endings) {
        lines.push(`${start} ${middle} ${ending}`);
      }
    }
  }
  return lines;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
