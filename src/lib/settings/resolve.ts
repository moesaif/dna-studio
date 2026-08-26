import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { findProvider, type CredentialField, type ProviderKind } from "@/lib/providers/registry";

export interface ResolvedSettings {
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  ollamaUrl: string;
  imageProvider: string;
  imageApiKey: string;
  videoProvider: string;
  videoApiKey: string;
}

export interface UserSettings {
  llmProvider?: string;
  llmApiKey?: string;
  llmModel?: string;
  ollamaUrl?: string;
  imageProvider?: string;
  imageApiKey?: string;
  videoProvider?: string;
  videoApiKey?: string;
}

export type CredentialOrigin = "user" | "env" | "default" | "none";

/** Ollama serves here out of the box, so an unset base URL is still a working one. */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface ResolvedCredential {
  value: string;
  origin: CredentialOrigin;
  envVar?: string;
}

const KIND_OF_FIELD: Record<CredentialField, ProviderKind> = {
  llmApiKey: "llm",
  ollamaUrl: "llm",
  imageApiKey: "image",
  videoApiKey: "video",
};

/**
 * Resolve one credential the way the app actually consumes it: a value saved
 * in settings wins, otherwise the environment variable that backs the selected
 * provider. Never borrows another provider's key.
 */
export function resolveCredential(
  field: CredentialField,
  providerId: string,
  userSettings: UserSettings,
  env: Partial<NodeJS.ProcessEnv> = process.env
): ResolvedCredential {
  const provider = findProvider(KIND_OF_FIELD[field], providerId);
  // Only borrow the provider's env var when that provider actually backs THIS
  // field. "llm" covers both llmApiKey and ollamaUrl, so resolving llmApiKey
  // against "ollama" would otherwise hand back OLLAMA_BASE_URL as an API key.
  const envVar = provider?.credential.field === field ? provider.credential.envVar : undefined;

  const saved = userSettings[field];
  if (saved) return { value: saved, origin: "user", envVar };

  const fromEnv = envVar ? env[envVar] : undefined;
  if (fromEnv) return { value: fromEnv, origin: "env", envVar };

  return { value: "", origin: "none", envVar };
}

/**
 * Like resolveCredential, but also applies the documented default a field has
 * when nothing is configured. Kept beside the raw resolver so the settings
 * surface reports exactly what the app will use.
 */
export function resolveCredentialWithDefault(
  field: CredentialField,
  providerId: string,
  userSettings: UserSettings,
  env: Partial<NodeJS.ProcessEnv> = process.env
): ResolvedCredential {
  const resolved = resolveCredential(field, providerId, userSettings, env);
  if (resolved.value || field !== "ollamaUrl") return resolved;
  return { value: DEFAULT_OLLAMA_URL, origin: "default", envVar: resolved.envVar };
}

export interface EffectiveProviders {
  llmProvider: string;
  imageProvider: string;
  videoProvider: string;
}

/**
 * Which provider each kind actually runs on: the user's saved choice, then the
 * documented environment variable, then the default. Anything that reports on
 * settings must select through this or it will resolve credentials against a
 * provider the app is not using.
 */
export function resolveProviders(
  userSettings: UserSettings,
  env: Partial<NodeJS.ProcessEnv> = process.env
): EffectiveProviders {
  return {
    llmProvider: userSettings.llmProvider || env.LLM_PROVIDER || "openai",
    imageProvider: userSettings.imageProvider || env.IMAGE_PROVIDER || "openai",
    videoProvider: userSettings.videoProvider || env.VIDEO_PROVIDER || "veo",
  };
}

/**
 * Resolve effective settings: user DB settings take priority, then env vars.
 */
export async function resolveSettings(): Promise<ResolvedSettings> {
  let userSettings: UserSettings = {};

  try {
    const session = await getSession();
    if (session?.user) {
      const user = await prisma.user.findUnique({
        where: { id: (session.user as { id: string }).id },
        select: { settings: true },
      });
      if (user?.settings) {
        userSettings = user.settings as unknown as UserSettings;
      }
    }
  } catch {
    // Fall through to env vars
  }

  const { llmProvider, imageProvider, videoProvider } = resolveProviders(userSettings);

  const llmApiKey = resolveCredential("llmApiKey", llmProvider, userSettings).value;

  // Resolve model
  let llmModel = userSettings.llmModel || "";
  if (!llmModel) {
    switch (llmProvider) {
      case "openai":
        llmModel = process.env.OPENAI_MODEL || "gpt-4o";
        break;
      case "anthropic":
        llmModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
        break;
      case "gemini":
        llmModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
        break;
      case "ollama":
        llmModel = process.env.OLLAMA_MODEL || "llama3.1";
        break;
    }
  }

  const imageApiKey = resolveCredential("imageApiKey", imageProvider, userSettings).value;

  const videoApiKey = resolveCredential("videoApiKey", videoProvider, userSettings).value;

  const ollamaUrl = resolveCredentialWithDefault("ollamaUrl", "ollama", userSettings).value;

  return {
    llmProvider,
    llmApiKey,
    llmModel,
    ollamaUrl,
    imageProvider,
    imageApiKey,
    videoProvider,
    videoApiKey,
  };
}
