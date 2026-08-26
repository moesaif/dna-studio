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

export type CredentialOrigin = "user" | "env" | "none";

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
  const envVar = provider?.credential.envVar;

  const saved = userSettings[field];
  if (saved) return { value: saved, origin: "user", envVar };

  const fromEnv = envVar ? env[envVar] : undefined;
  if (fromEnv) return { value: fromEnv, origin: "env", envVar };

  return { value: "", origin: "none", envVar };
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

  const llmProvider = userSettings.llmProvider || process.env.LLM_PROVIDER || "openai";

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

  const imageProvider = userSettings.imageProvider || process.env.IMAGE_PROVIDER || "openai";

  const imageApiKey = resolveCredential("imageApiKey", imageProvider, userSettings).value;

  const videoProvider = userSettings.videoProvider || process.env.VIDEO_PROVIDER || "veo";

  const videoApiKey = resolveCredential("videoApiKey", videoProvider, userSettings).value;

  const ollamaUrl =
    resolveCredential("ollamaUrl", "ollama", userSettings).value || "http://localhost:11434";

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
