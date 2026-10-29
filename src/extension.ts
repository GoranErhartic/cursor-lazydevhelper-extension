import * as vscode from "vscode";
import { KeyStore } from "./auth/keyStore";
import { runCodeAction } from "./actions/runAction";
import {
  clearStoredKey,
  runConfigureProviderFlow,
  runSelectModelFlow,
  SetupContext,
} from "./setup/setupFlow";
import { ResultPanel } from "./ui/resultPanel";

export function activate(context: vscode.ExtensionContext): void {
  const keyStore = new KeyStore(context.secrets);
  const setupCtx: SetupContext = { keyStore };

  const register = (command: string, handler: () => Promise<void>) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register("lazydev.analyze", () =>
    runCodeAction({ ...setupCtx, resultPanel: new ResultPanel(context.extensionUri) }, "analyze")
  );
  register("lazydev.review", () =>
    runCodeAction({ ...setupCtx, resultPanel: new ResultPanel(context.extensionUri) }, "review")
  );
  register("lazydev.simplify", () =>
    runCodeAction({ ...setupCtx, resultPanel: new ResultPanel(context.extensionUri) }, "simplify")
  );
  register("lazydev.configureProvider", async () => {
    await runConfigureProviderFlow(setupCtx);
  });
  register("lazydev.selectModel", async () => {
    await runSelectModelFlow(setupCtx);
  });
  register("lazydev.clearKey", () => clearStoredKey(setupCtx));
}

export function deactivate(): void {}
