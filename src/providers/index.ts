import type { ProviderId } from "../config/settings";
import { AnthropicProvider } from "./anthropic";
import { CursorProvider } from "./cursor";
import { OpenAiProvider } from "./openai";
import { LlmProvider } from "./Provider";

const openai = new OpenAiProvider();
const anthropic = new AnthropicProvider();
const cursor = new CursorProvider();

export function getProvider(id: ProviderId): LlmProvider {
  switch (id) {
    case "openai":
      return openai;
    case "anthropic":
      return anthropic;
    case "cursor":
      return cursor;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function allProviders(): LlmProvider[] {
  return [openai, anthropic, cursor];
}
