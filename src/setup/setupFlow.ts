import * as vscode from "vscode";
import { KeyStore } from "../auth/keyStore";
import {
  getConfiguredModel,
  getConfiguredProvider,
  ProviderId,
  setConfiguredModel,
  setConfiguredProvider,
} from "../config/settings";
import { allProviders, getProvider } from "../providers";
import { ProviderError } from "../providers/Provider";

export type SetupContext = {
  keyStore: KeyStore;
};

export async function pickProvider(): Promise<ProviderId | undefined> {
  const items = allProviders().map((p) => ({
    label: p.displayName,
    description: p.id,
    id: p.id,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "LazyDev AI — Select provider",
    placeHolder: "Choose an LLM provider",
  });
  return picked?.id;
}

export async function promptApiKey(providerName: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: `LazyDev AI — ${providerName} API key`,
    prompt: "Enter your API key (stored securely in Secret Storage)",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return "API key is required";
      }
      return undefined;
    },
  });
}

export async function validateAndStoreKey(
  ctx: SetupContext,
  providerId: ProviderId,
  apiKey: string
): Promise<boolean> {
  const provider = getProvider(providerId);
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Validating ${provider.displayName} API key…`,
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        await provider.validateKey(apiKey, controller.signal);
      }
    );
  } catch (err) {
    if (err instanceof ProviderError) {
      await vscode.window.showErrorMessage(`LazyDev AI: ${err.message}`);
    } else if (err instanceof Error && err.name === "AbortError") {
      return false;
    } else {
      await vscode.window.showErrorMessage(
        "LazyDev AI: Could not validate API key. Check your network connection."
      );
    }
    return false;
  }

  await ctx.keyStore.setKey(providerId, apiKey);
  if (getConfiguredProvider() !== providerId) {
    // A model from another provider is not valid here; force a fresh pick.
    await setConfiguredModel("");
  }
  await setConfiguredProvider(providerId);
  // Do not await: the toast promise only resolves on dismissal and would block the model picker.
  void vscode.window.showInformationMessage(
    `LazyDev AI: ${provider.displayName} API key verified.`
  );
  return true;
}

export async function pickModelForProvider(
  providerId: ProviderId,
  apiKey: string
): Promise<string | undefined> {
  const provider = getProvider(providerId);
  let models: string[];
  try {
    models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading models…",
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        return provider.listModels(apiKey, controller.signal);
      }
    );
  } catch (err) {
    if (err instanceof ProviderError) {
      await vscode.window.showErrorMessage(`LazyDev AI: ${err.message}`);
    } else {
      await vscode.window.showErrorMessage("LazyDev AI: Failed to load models.");
    }
    return undefined;
  }

  if (models.length === 0) {
    await vscode.window.showWarningMessage("LazyDev AI: No models returned by the provider.");
    return undefined;
  }

  const current = getConfiguredModel();
  const picked = await vscode.window.showQuickPick(
    models.map((m) => ({
      label: m,
      picked: m === current,
    })),
    {
      title: "LazyDev AI — Select model",
      placeHolder: "Choose a model for code actions",
    }
  );
  return picked?.label;
}

export async function runConfigureProviderFlow(ctx: SetupContext): Promise<boolean> {
  const providerId = await pickProvider();
  if (!providerId) {
    return false;
  }
  const provider = getProvider(providerId);
  const apiKey = await promptApiKey(provider.displayName);
  if (!apiKey?.trim()) {
    return false;
  }
  const ok = await validateAndStoreKey(ctx, providerId, apiKey.trim());
  if (!ok) {
    return false;
  }
  const model = await pickModelForProvider(providerId, apiKey.trim());
  if (model) {
    await setConfiguredModel(model);
    void vscode.window.showInformationMessage(`LazyDev AI: Using model ${model}.`);
  }
  return true;
}

export async function runSelectModelFlow(ctx: SetupContext): Promise<boolean> {
  const providerId = getConfiguredProvider();
  const apiKey = await ctx.keyStore.getKey(providerId);
  if (!apiKey) {
    const configured = await runConfigureProviderFlow(ctx);
    return configured;
  }
  const model = await pickModelForProvider(providerId, apiKey);
  if (!model) {
    return false;
  }
  await setConfiguredModel(model);
  void vscode.window.showInformationMessage(`LazyDev AI: Using model ${model}.`);
  return true;
}

export async function ensureReady(ctx: SetupContext): Promise<{
  providerId: ProviderId;
  apiKey: string;
  model: string;
} | undefined> {
  let providerId = getConfiguredProvider();
  let apiKey = await ctx.keyStore.getKey(providerId);
  let model = getConfiguredModel();

  if (!apiKey || !model) {
    const proceed = await vscode.window.showInformationMessage(
      "LazyDev AI needs an API key and model before running actions.",
      "Configure",
      "Cancel"
    );
    if (proceed !== "Configure") {
      return undefined;
    }
    const ok = await runConfigureProviderFlow(ctx);
    if (!ok) {
      return undefined;
    }
    providerId = getConfiguredProvider();
    apiKey = await ctx.keyStore.getKey(providerId);
    model = getConfiguredModel();
  }

  if (!apiKey || !model) {
    return undefined;
  }
  return { providerId, apiKey, model };
}

export async function clearStoredKey(ctx: SetupContext): Promise<void> {
  const providerId = getConfiguredProvider();
  await ctx.keyStore.deleteKey(providerId);
  await setConfiguredModel("");
  await vscode.window.showInformationMessage(
    `LazyDev AI: Cleared stored API key for ${providerId}.`
  );
}
