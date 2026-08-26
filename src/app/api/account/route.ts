import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, password: true },
    });
    return NextResponse.json({
      name: user?.name ?? null,
      email: user?.email ?? null,
      hasPassword: Boolean(user?.password),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const { name, email, currentPassword } = patchSchema.parse(await request.json());

    const data: { name?: string; email?: string } = {};
    if (name) data.name = name;

    if (email) {
      const account = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { password: true },
      });
      const ok =
        Boolean(currentPassword) &&
        Boolean(account?.password) &&
        (await bcrypt.compare(currentPassword!, account!.password!));
      if (!ok) {
        return NextResponse.json({ error: "Current password required" }, { status: 401 });
      }

      const taken = await prisma.user.findFirst({ where: { email, NOT: { id: session.user.id } } });
      if (taken) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      data.email = email;
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { name: true, email: true },
    });

    return NextResponse.json(updated);
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
