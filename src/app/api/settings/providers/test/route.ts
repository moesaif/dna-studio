import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { findProvider } from "@/lib/providers/registry";
import { checkCooldown } from "@/lib/providers/cooldown";
import { resolveCredentialWithDefault, type UserSettings } from "@/lib/settings/resolve";

const schema = z.object({
  kind: z.enum(["llm", "image", "video"]),
  providerId: z.string().min(1),
  credential: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const { kind, providerId, credential } = schema.parse(await request.json());

    const provider = findProvider(kind, providerId);
    if (!provider) {
      return NextResponse.json({ ok: false, message: "Unknown provider" }, { status: 400 });
    }

    const gate = checkCooldown(session.user.id);
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, message: `Too many tests. Try again in ${gate.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
      );
    }

    let value = credential;
    if (!value) {
      const stored = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { settings: true },
      });
      const settings = (stored?.settings as unknown as UserSettings) || {};
      // WithDefault so a local-Ollama user with nothing configured tests the
      // documented default the app would actually call, not "Nothing to test".
      value = resolveCredentialWithDefault(provider.credential.field, providerId, settings).value;
    }

    if (!value) {
      return NextResponse.json(
        { ok: false, message: "Nothing to test — no key saved here or in the environment." },
        { status: 400 }
      );
    }

    try {
      await provider.test(value);
    } catch (error) {
      // provider.test throws messages that never contain the credential
      return NextResponse.json(
        { ok: false, message: error instanceof Error ? error.message : "Test failed" },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: "Test failed" }, { status: 500 });
  }
}
