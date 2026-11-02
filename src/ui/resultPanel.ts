import * as vscode from "vscode";
import { ActionKind } from "../actions/prompts";
import { renderMarkdownToHtml } from "./markdown";
import { LOADING_LINES, LOADING_LINE_HOLD_MS, LOADING_TYPE_INTERVAL_MS } from "./loadingLines";

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
        ? getLoadingHtml()
        : renderMarkdownToHtml("_No response generated._");

    this.panel.webview.html = getWebviewHtml({
      nonce,
      title: this.options.title,
      bodyHtml,
      loadingMessages: LOADING_LINES,
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
  loadingMessages: readonly string[];
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
      max-width: 100%;
      box-sizing: border-box;
    }
    .loader-text { display: block; min-width: 0; }
    .loader-text strong, .loader-text .loader-dots { display: inline; white-space: normal; }
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
    if (loadingEl && Array.isArray(loadingMessages) && loadingMessages.length > 0) {
      const holdMs = ${LOADING_LINE_HOLD_MS};
      const typeMs = ${LOADING_TYPE_INTERVAL_MS};
      const state = vscode.getState() || {};
      const pickIndex = (previous) => {
        if (loadingMessages.length < 2) {
          return 0;
        }
        let next = previous;
        while (next === previous) {
          next = Math.floor(Math.random() * loadingMessages.length);
        }
        return next;
      };
      const isValid = (i) => Number.isInteger(i) && i >= 0 && i < loadingMessages.length;

      let index = isValid(state.loaderIndex) ? state.loaderIndex : pickIndex(-1);
      let nextSwitchAt = typeof state.nextSwitchAt === "number" ? state.nextSwitchAt : 0;

      const typeLine = (text, done) => {
        let i = 0;
        loadingEl.textContent = "";
        const step = () => {
          i += 1;
          loadingEl.textContent = text.slice(0, i);
          if (i < text.length) {
            setTimeout(step, typeMs);
          } else {
            done();
          }
        };
        setTimeout(step, typeMs);
      };

      const showNext = () => {
        index = pickIndex(index);
        const line = loadingMessages[index];
        nextSwitchAt = Date.now() + holdMs;
        vscode.setState({ loaderIndex: index, nextSwitchAt });
        typeLine(line, () => {});
        setTimeout(showNext, holdMs);
      };

      const remaining = nextSwitchAt - Date.now();
      if (isValid(state.loaderIndex) && remaining > 0) {
        // Panel was re-rendered mid-hold: show the current line instantly and keep the schedule.
        loadingEl.textContent = loadingMessages[index];
        setTimeout(showNext, remaining);
      } else {
        showNext();
      }
    }
  </script>
</body>
</html>`;
}

function getLoadingHtml(): string {
  return `<div class="loader"><div class="spinner" aria-hidden="true"></div><div class="loader-text"><strong id="loader-message">Waiting for response</strong><span class="loader-dots"></span></div></div>`;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
