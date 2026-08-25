import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return { prisma: { uGCVideo: model(), uGCCharacter: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/video/client", () => ({ getVideoProvider: vi.fn() }));
vi.mock("@/lib/settings/resolve", () => ({ resolveSettings: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { getVideoProvider } from "@/lib/video/client";
import { resolveSettings } from "@/lib/settings/resolve";
import { GET as listVideos, POST as createVideo } from "@/app/api/ugc/route";
import { GET as getVideo, PATCH as patchVideo, DELETE as deleteVideo } from "@/app/api/ugc/[id]/route";
import { GET as listAvatars } from "@/app/api/ugc/avatars/route";
import { GET as download } from "@/app/api/ugc/download/route";

const video = vi.mocked(prisma.uGCVideo);
const character = vi.mocked(prisma.uGCCharacter);
const session = vi.mocked(requireSession);
const videoProvider = vi.mocked(getVideoProvider);
const settings = vi.mocked(resolveSettings);

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = (b: unknown) =>
  new Request("http://localhost/api/ugc", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("GET /api/ugc", () => {
  it("lists the user's videos newest first", async () => {
    video.findMany.mockResolvedValue([{ id: "v1" }] as never);

    expect((await listVideos()).status).toBe(200);
    expect(video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" }, orderBy: { createdAt: "desc" } })
    );
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await listVideos()).status).toBe(401);
  });
});

describe("POST /api/ugc", () => {
  beforeEach(() => {
    video.create.mockResolvedValue({ id: "v1" } as never);
  });

  it("creates a video owned by the signed-in user and answers 201", async () => {
    const response = await createVideo(
      body({ avatarId: "av_1", script: "Try our mug", provider: "veo", aspectRatio: "16:9" })
    );

    expect(response.status).toBe(201);
    expect(video.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        avatarId: "av_1",
        script: "Try our mug",
        provider: "veo",
        aspectRatio: "16:9",
        status: "generating",
      }),
    });
  });

  it("applies documented defaults", async () => {
    await createVideo(body({ avatarId: "av_1", script: "hi" }));

    expect(video.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scriptSource: "custom",
        provider: "heygen",
        aspectRatio: "9:16",
        productImage: null,
        productDescription: null,
      }),
    });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await createVideo(body({}))).status).toBe(401);
    expect(video.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/ugc/[id]", () => {
  beforeEach(() => {
    video.findFirst.mockResolvedValue({ id: "v1" } as never);
    video.update.mockResolvedValue({ id: "v1" } as never);
  });

  it("writes only the fields present in the body", async () => {
    await patchVideo(body({ status: "complete", videoUrl: "https://cdn/v.mp4" }), params("v1"));

    expect(video.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { status: "complete", videoUrl: "https://cdn/v.mp4" },
    });
  });

  it("treats a zero duration as a value worth writing", async () => {
    await patchVideo(body({ duration: 0 }), params("v1"));
    expect(video.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { duration: 0 } });
  });

  it("ignores fields that are not in the allowed set", async () => {
    await patchVideo(body({ userId: "someone_else", status: "complete" }), params("v1"));
    expect(video.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { status: "complete" } });
  });

  it("answers 404 without updating someone else's video", async () => {
    video.findFirst.mockResolvedValue(null as never);
    expect((await patchVideo(body({ status: "x" }), params("v1"))).status).toBe(404);
    expect(video.update).not.toHaveBeenCalled();
  });
});

describe("GET and DELETE /api/ugc/[id]", () => {
  it("returns a video the user owns", async () => {
    video.findFirst.mockResolvedValue({ id: "v1" } as never);
    expect((await getVideo(new Request("http://localhost"), params("v1"))).status).toBe(200);
  });

  it("answers 404 for someone else's video", async () => {
    video.findFirst.mockResolvedValue(null as never);
    expect((await getVideo(new Request("http://localhost"), params("v1"))).status).toBe(404);
  });

  it("deletes a video the user owns", async () => {
    video.findFirst.mockResolvedValue({ id: "v1" } as never);
    video.delete.mockResolvedValue({} as never);

    expect((await deleteVideo(new Request("http://localhost"), params("v1"))).status).toBe(200);
    expect(video.delete).toHaveBeenCalledWith({ where: { id: "v1" } });
  });

  it("answers 404 without deleting someone else's video", async () => {
    video.findFirst.mockResolvedValue(null as never);
    expect((await deleteVideo(new Request("http://localhost"), params("v1"))).status).toBe(404);
    expect(video.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/ugc/avatars", () => {
  it("returns active characters from the database, ordered", async () => {
    character.findMany.mockResolvedValue([
      { id: "c1", name: "Mia", description: "d", gender: "f", style: "casual", previewVideoUrl: null, thumbnailUrl: null },
    ] as never);

    const response = await listAvatars();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: "c1", name: "Mia", description: "d", gender: "f", style: "casual", previewVideoUrl: null, thumbnailUrl: null },
    ]);
    expect(character.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
  });

  it("falls back to the video provider when no characters are seeded", async () => {
    character.findMany.mockResolvedValue([] as never);
    videoProvider.mockResolvedValue({
      listAvatars: vi.fn().mockResolvedValue([{ id: "heygen_1" }]),
    } as never);

    await expect((await listAvatars()).json()).resolves.toEqual([{ id: "heygen_1" }]);
  });

  it("returns an empty list when the provider is unreachable", async () => {
    character.findMany.mockResolvedValue([] as never);
    videoProvider.mockRejectedValue(new Error("no api key"));

    const response = await listAvatars();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await listAvatars()).status).toBe(401);
  });
});

describe("GET /api/ugc/download", () => {
  const get = (query: string) => new Request(`http://localhost/api/ugc/download${query}`);

  beforeEach(() => {
    settings.mockResolvedValue({ videoApiKey: "goog-key" } as never);
  });

  it("requires a fileId", async () => {
    const response = await download(get(""));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing fileId" });
  });

  it.each([
    "../../../etc/passwd",
    "abc/../secret",
    "file id",
    "abc?alt=media&x=1",
    "http://evil.test/",
  ])("rejects a fileId containing %j rather than fetching it", async (fileId) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await download(get(`?fileId=${encodeURIComponent(fileId)}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid fileId" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies the video without exposing the API key to the client", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await download(get("?fileId=files_abc-123"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/files/files_abc-123?alt=media",
      { headers: { "x-goog-api-key": "goog-key" } }
    );
  });

  it("answers 500 when no API key is configured", async () => {
    settings.mockResolvedValue({ videoApiKey: "" } as never);
    const response = await download(get("?fileId=abc"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "No API key configured" });
  });

  it("passes the upstream status through when the download fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const response = await download(get("?fileId=abc"));
    expect(response.status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await download(get("?fileId=abc"))).status).toBe(401);
  });
});
