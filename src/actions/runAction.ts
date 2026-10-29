import * as vscode from "vscode";
import { ActionKind, actionTitle, buildMessages, extractFirstCodeBlock } from "./prompts";
import { getMaxSelectionChars } from "../config/settings";
import { getProvider } from "../providers";
import { ProviderError } from "../providers/Provider";
import { ensureReady, runConfigureProviderFlow, SetupContext } from "../setup/setupFlow";
import { ResultPanel, ApplyTarget } from "../ui/resultPanel";

export type RunActionDeps = SetupContext & {
  resultPanel: ResultPanel;
};

export async function runCodeAction(
  deps: RunActionDeps,
  action: ActionKind
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    await vscode.window.showWarningMessage("LazyDev AI: Select a code block first.");
    return;
  }

  const document = editor.document;
  const selection = editor.selection;
  const code = document.getText(selection);
  const maxChars = getMaxSelectionChars();
  if (code.length > maxChars) {
    await vscode.window.showErrorMessage(
      `LazyDev AI: Selection is too large (${code.length} chars). Max is ${maxChars}.`
    );
    return;
  }

  const ready = await ensureReady(deps);
  if (!ready) {
    return;
  }

  const { providerId, apiKey, model } = ready;
  const provider = getProvider(providerId);
  const { system, user } = buildMessages(action, {
    languageId: document.languageId,
    fileName: vscode.workspace.asRelativePath(document.uri),
    code,
  });

  const docVersion = document.version;
  const applyTarget: ApplyTarget | undefined =
    action === "simplify"
      ? {
          uri: document.uri,
          range: selection,
          documentVersion: docVersion,
          languageId: document.languageId,
        }
      : undefined;

  const panel = deps.resultPanel;
  panel.show({
    title: actionTitle(action),
    action,
    applyTarget,
    onApply: async (fullText) => {
      if (!applyTarget) {
        return;
      }
      const simplified =
        extractFirstCodeBlock(fullText, applyTarget.languageId) ?? fullText.trim();
      const current = await vscode.workspace.openTextDocument(applyTarget.uri);
      if (current.version !== applyTarget.documentVersion) {
        const choice = await vscode.window.showWarningMessage(
          "The file changed since the action ran. Apply anyway?",
          "Apply",
          "Cancel"
        );
        if (choice !== "Apply") {
          return;
        }
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(applyTarget.uri, applyTarget.range, simplified);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        await vscode.window.showInformationMessage("LazyDev AI: Simplified code applied.");
      }
    },
  });

  const controller = new AbortController();
  panel.setAbortHandler(() => controller.abort());

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `LazyDev AI: ${actionTitle(action)}…`,
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => controller.abort());
      panel.setStatus("Streaming…");
      try {
        await provider.stream(
          {
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          },
          apiKey,
          (chunk) => panel.append(chunk),
          controller.signal,
          (status) => panel.setStatus(status)
        );
        panel.setStatus("Done");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          panel.setStatus("Cancelled");
          return;
        }
        panel.setStatus("Error");
        if (err instanceof ProviderError && err.code === "invalid_key") {
          const choice = await vscode.window.showErrorMessage(
            `LazyDev AI: ${err.message}`,
            "Reconfigure"
          );
          if (choice === "Reconfigure") {
            await runConfigureProviderFlow(deps);
          }
        } else if (err instanceof ProviderError) {
          await vscode.window.showErrorMessage(`LazyDev AI: ${err.message}`);
        } else {
          await vscode.window.showErrorMessage("LazyDev AI: Request failed.");
        }
      } finally {
        panel.clearAbortHandler();
      }
    }
  );
}
