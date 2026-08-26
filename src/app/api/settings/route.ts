import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PROVIDERS, type CredentialField } from "@/lib/providers/registry";
import { resolveCredential, type UserSettings } from "@/lib/settings/resolve";

const CREDENTIAL_FIELDS: CredentialField[] = [
  "llmApiKey",
  "imageApiKey",
  "videoApiKey",
  "ollamaUrl",
];

const idsOf = (kind: "llm" | "image" | "video") =>
  PROVIDERS.filter((p) => p.kind === kind).map((p) => p.id) as [string, ...string[]];

const settingsPatchSchema = z
  .object({
    llmProvider: z.enum(idsOf("llm")),
    llmApiKey: z.string(),
    llmModel: z.string(),
    ollamaUrl: z.string(),
    imageProvider: z.enum(idsOf("image")),
    imageApiKey: z.string(),
    videoProvider: z.enum(idsOf("video")),
    videoApiKey: z.string(),
  })
  .partial()
  .strict();

/** A submitted value that still carries the mask must not overwrite the stored key. */
function keepIfMasked(submitted: string | undefined, stored: string | undefined) {
  if (!submitted || submitted.includes("••••")) return stored;
  return submitted;
}

/**
 * Reports, per credential field, whether the effective value comes from the
 * user's saved settings, the environment, or is unset — never the value itself.
 *
 * The provider id used to resolve each field must match the provider that
 * field actually belongs to: llmApiKey and ollamaUrl are both LLM-kind
 * credentials, but ollamaUrl always belongs to the "ollama" provider
 * specifically — it must never be resolved against whichever LLM provider
 * happens to be selected (e.g. "openai"), or the report would claim an
 * environment variable (OPENAI_API_KEY) that the resolver would never
 * actually use to back the Ollama URL.
 */
function buildSources(settings: UserSettings) {
  const sources: Record<string, unknown> = {};
  for (const field of CREDENTIAL_FIELDS) {
    const providerId =
      field === "imageApiKey"
        ? (settings.imageProvider ?? "openai")
        : field === "videoApiKey"
          ? (settings.videoProvider ?? "veo")
          : field === "ollamaUrl"
            ? "ollama"
            : (settings.llmProvider ?? "openai");

    const { origin, envVar, value } = resolveCredential(field, providerId, settings);
    sources[field] = {
      source: origin,
      envVar,
      masked: value ? maskKey(value) : undefined,
    };
  }
  return sources;
}

export async function GET() {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { settings: true },
    });

    const settings = (user?.settings as unknown as UserSettings) || {};
    // Mask API keys for display
    const masked: UserSettings = {
      ...settings,
      llmApiKey: settings.llmApiKey ? maskKey(settings.llmApiKey) : "",
      imageApiKey: settings.imageApiKey ? maskKey(settings.imageApiKey) : "",
      ...(settings.videoApiKey ? { videoApiKey: maskKey(settings.videoApiKey) } : {}),
    };

    return NextResponse.json({ settings: masked, sources: buildSources(settings) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    const patch = settingsPatchSchema.parse(await request.json());

    // Get current settings to preserve keys that weren't changed
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { settings: true },
    });
    const current = (user?.settings as unknown as UserSettings) || {};

    const updated: UserSettings = {
      ...current,
      ...patch,
      // Only update keys if the value isn't a masked placeholder
      llmApiKey: keepIfMasked(patch.llmApiKey, current.llmApiKey),
      imageApiKey: keepIfMasked(patch.imageApiKey, current.imageApiKey),
      videoApiKey: keepIfMasked(patch.videoApiKey, current.videoApiKey),
    };

    await prisma.user.update({
      where: { id: session.user.id },
      data: { settings: JSON.parse(JSON.stringify(updated)) },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid settings", issues: error.issues }, { status: 400 });
    }
    console.error("[Settings] Failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
