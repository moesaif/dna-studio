import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { uGCCharacter: { findMany: vi.fn(), findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { VeoProvider } from "@/lib/video/providers/veo";

const character = vi.mocked(prisma.uGCCharacter);
const fetchMock = vi.fn();

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const call = (n = 0) => ({
  url: fetchMock.mock.calls[n][0] as string,
  init: (fetchMock.mock.calls[n][1] ?? {}) as { headers: Record<string, string>; body?: string },
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  character.findMany.mockResolvedValue([] as never);
  character.findUnique.mockResolvedValue(null as never);
});

describe("VeoProvider", () => {
  it("reads the key from GOOGLE_API_KEY when not given one", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "goog-env");
    fetchMock.mockResolvedValue(ok({ name: "operations/1" }));

    await new VeoProvider().generate({ script: "s", avatarId: "a" });

    expect(call().init.headers["x-goog-api-key"]).toBe("goog-env");
  });

  describe("listAvatars", () => {
    it("maps seeded characters, preferring the preview video as thumbnail", async () => {
      character.findMany.mockResolvedValue([
        {
          id: "c1", name: "Mia", previewVideoUrl: "https://cdn/p.mp4",
          thumbnailUrl: "https://cdn/t.png", gender: "female", style: "casual",
        },
      ] as never);

      await expect(new VeoProvider("k").listAvatars()).resolves.toEqual([
        { id: "c1", name: "Mia", thumbnailUrl: "https://cdn/p.mp4", gender: "female", style: "casual" },
      ]);
      expect(character.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      });
    });

    it("falls back to the thumbnail, then an empty string", async () => {
      character.findMany.mockResolvedValue([
        { id: "c1", name: "A", previewVideoUrl: null, thumbnailUrl: "https://cdn/t.png", gender: "male", style: "s" },
        { id: "c2", name: "B", previewVideoUrl: null, thumbnailUrl: null, gender: "male", style: "s" },
      ] as never);

      const avatars = await new VeoProvider("k").listAvatars();
      expect(avatars[0].thumbnailUrl).toBe("https://cdn/t.png");
      expect(avatars[1].thumbnailUrl).toBe("");
    });

    it("returns an empty list when the database is unavailable", async () => {
      character.findMany.mockRejectedValue(new Error("db down"));
      await expect(new VeoProvider("k").listAvatars()).resolves.toEqual([]);
    });
  });

  describe("generate", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(ok({ name: "operations/abc" }));
    });

    it("returns the long-running operation name as the video id", async () => {
      await expect(
        new VeoProvider("k").generate({ script: "Try our mug", avatarId: "c1" })
      ).resolves.toEqual({ videoId: "operations/abc", status: "queued" });
    });

    it.each([
      [undefined, "9:16"],
      ["9:16", "9:16"],
      ["16:9", "16:9"],
      ["1:1", "16:9"],
    ])("maps aspect ratio %s to %s", async (requested, expected) => {
      await new VeoProvider("k").generate({
        script: "s",
        avatarId: "c1",
        ...(requested ? { aspectRatio: requested as "16:9" } : {}),
      });

      expect(JSON.parse(call().init.body!).parameters.aspectRatio).toBe(expected);
    });

    it("weaves the character's description into the prompt", async () => {
      character.findUnique.mockResolvedValue({ description: "a woman in her 30s" } as never);

      await new VeoProvider("k").generate({ script: "Try our mug", avatarId: "c1" });

      const prompt = JSON.parse(call().init.body!).instances[0].prompt;
      expect(prompt).toContain("a woman in her 30s");
      expect(prompt).toContain("Try our mug");
    });

    it("uses a generic prompt when the character is unknown", async () => {
      await new VeoProvider("k").generate({ script: "Try our mug", avatarId: "unknown" });

      const prompt = JSON.parse(call().init.body!).instances[0].prompt;
      expect(prompt).toContain("a person talking directly to camera");
      expect(prompt).toContain("Try our mug");
    });

    it("still generates when the character lookup fails", async () => {
      character.findUnique.mockRejectedValue(new Error("db down"));

      await expect(
        new VeoProvider("k").generate({ script: "s", avatarId: "c1" })
      ).resolves.toMatchObject({ status: "queued" });
    });

    it("surfaces the API error message", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "quota exceeded" } }),
      });

      await expect(
        new VeoProvider("k").generate({ script: "s", avatarId: "c1" })
      ).rejects.toThrow("Veo generation error: quota exceeded");
    });

    it("falls back to the status code when the error body is unreadable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      });

      await expect(
        new VeoProvider("k").generate({ script: "s", avatarId: "c1" })
      ).rejects.toThrow("Veo generation error: 503");
    });

    it("throws when no operation name comes back", async () => {
      fetchMock.mockResolvedValue(ok({}));
      await expect(
        new VeoProvider("k").generate({ script: "s", avatarId: "c1" })
      ).rejects.toThrow("Veo did not return an operation name");
    });
  });

  describe("getStatus", () => {
    it("reports processing while the operation is not done", async () => {
      fetchMock.mockResolvedValue(ok({ done: false }));

      await expect(new VeoProvider("k").getStatus("operations/abc")).resolves.toEqual({
        videoId: "operations/abc",
        status: "processing",
      });
    });

    it("returns a proxied download URL rather than the raw Google URL", async () => {
      fetchMock.mockResolvedValue(
        ok({
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/file_123" } },
              ],
            },
          },
        })
      );

      const result = await new VeoProvider("k").getStatus("operations/abc");

      expect(result.status).toBe("completed");
      expect(result.videoUrl).toBe("/api/ugc/download?fileId=file_123");
      expect(result.videoUrl).not.toContain("googleapis.com");
    });

    it("reports failure when the operation finishes without a video", async () => {
      fetchMock.mockResolvedValue(ok({ done: true, response: {} }));

      await expect(new VeoProvider("k").getStatus("operations/abc")).resolves.toEqual({
        videoId: "operations/abc",
        status: "failed",
        error: "Veo completed but returned no video",
      });
    });

    it("throws on an API error", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      await expect(new VeoProvider("k").getStatus("operations/abc")).rejects.toThrow(
        "Veo status error: 404"
      );
    });
  });
});
