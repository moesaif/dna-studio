import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getImageProvider } from "@/lib/image/client";
import type { ImageSize } from "@/lib/image/types";

const schema = z.object({
  prompt: z.string().min(1).max(4000),
  size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).default("1024x1024"),
  assetId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const { prompt, size, assetId } = schema.parse(body);

    const provider = await getImageProvider();
    const { url: imageUrl } = await provider.generate(prompt, { size: size as ImageSize });

    if (assetId) {
      // Scoped through the campaign relation: updating by id alone let any
      // signed-in caller overwrite an asset belonging to another account.
      const { count } = await prisma.asset.updateMany({
        where: { id: assetId, campaign: { userId: session.user.id } },
        data: { imageUrl },
      });

      if (count === 0) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ url: imageUrl });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[Image Gen] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image generation failed" },
      { status: 500 }
    );
  }
}
