import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const { currentPassword, newPassword } = schema.parse(await request.json());

    const account = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    });

    // Accounts created through Google have no password to prove. Setting the
    // first one from an authenticated session is not an escalation.
    if (account?.password) {
      const ok = Boolean(currentPassword) && (await bcrypt.compare(currentPassword!, account.password));
      if (!ok) {
        return NextResponse.json({ error: "Current password required" }, { status: 401 });
      }
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: await bcrypt.hash(newPassword, 12) },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
