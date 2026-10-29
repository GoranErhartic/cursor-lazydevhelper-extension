import * as vscode from "vscode";

export type ProviderId = "openai" | "anthropic" | "cursor";

export const PROVIDER_IDS: ProviderId[] = ["openai", "anthropic", "cursor"];

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

export function secretKeyForProvider(providerId: ProviderId): string {
  return `lazydev.apiKey.${providerId}`;
}

export function getConfiguredProvider(): ProviderId {
  const config = vscode.workspace.getConfiguration("lazydev");
  const raw = config.get<string>("provider", "openai");
  return isProviderId(raw) ? raw : "openai";
}

export function getConfiguredModel(): string {
  return vscode.workspace.getConfiguration("lazydev").get<string>("model", "").trim();
}

export async function setConfiguredProvider(providerId: ProviderId): Promise<void> {
  await vscode.workspace
    .getConfiguration("lazydev")
    .update("provider", providerId, vscode.ConfigurationTarget.Global);
}

export async function setConfiguredModel(model: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("lazydev")
    .update("model", model, vscode.ConfigurationTarget.Global);
}

export function getMaxSelectionChars(): number {
  return vscode.workspace.getConfiguration("lazydev").get<number>("maxSelectionChars", 50000);
}
