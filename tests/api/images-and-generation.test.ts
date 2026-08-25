import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  return { prisma: { asset: model(), campaign: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/image/client", () => ({ getImageProvider: vi.fn() }));
vi.mock("@/lib/video/client", () => ({ getVideoProvider: vi.fn() }));
vi.mock("@/lib/llm/client", () => ({ generateText: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { getImageProvider } from "@/lib/image/client";
import { getVideoProvider } from "@/lib/video/client";
import { generateText } from "@/lib/llm/client";
import { POST as generateImage } from "@/app/api/images/generate/route";
import { POST as ugcGenerate } from "@/app/api/ugc/generate/route";
import { GET as getCampaign } from "@/app/api/campaigns/[id]/route";

const asset = vi.mocked(prisma.asset);
const campaign = vi.mocked(prisma.campaign);
const session = vi.mocked(requireSession);
const imageProvider = vi.mocked(getImageProvider);
const videoProvider = vi.mocked(getVideoProvider);
const llmText = vi.mocked(generateText);

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("POST /api/images/generate", () => {
  const generate = vi.fn();

  beforeEach(() => {
    generate.mockResolvedValue({ url: "https://cdn/out.png" });
    imageProvider.mockResolvedValue({ generate } as never);
    asset.updateMany.mockResolvedValue({ count: 1 } as never);
  });

  it("returns the generated image URL", async () => {
    const response = await generateImage(post("/api/images/generate", { prompt: "a mug" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://cdn/out.png" });
    expect(generate).toHaveBeenCalledWith("a mug", { size: "1024x1024" });
  });

  it("passes a requested size through", async () => {
    await generateImage(post("/api/images/generate", { prompt: "a mug", size: "1792x1024" }));
    expect(generate).toHaveBeenCalledWith("a mug", { size: "1792x1024" });
  });

  it("does not touch the database when no assetId is given", async () => {
    await generateImage(post("/api/images/generate", { prompt: "a mug" }));
    expect(asset.updateMany).not.toHaveBeenCalled();
  });

  it("only updates an asset that belongs to the caller", async () => {
    await generateImage(post("/api/images/generate", { prompt: "a mug", assetId: "asset_1" }));

    expect(asset.updateMany).toHaveBeenCalledWith({
      where: { id: "asset_1", campaign: { userId: "user_1" } },
      data: { imageUrl: "https://cdn/out.png" },
    });
  });

  it("answers 404 rather than writing to someone else's asset", async () => {
    asset.updateMany.mockResolvedValue({ count: 0 } as never);

    const response = await generateImage(
      post("/api/images/generate", { prompt: "a mug", assetId: "someone_elses_asset" })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Asset not found" });
  });

  it.each([
    ["an empty prompt", { prompt: "" }],
    ["a missing prompt", {}],
    ["an unsupported size", { prompt: "a mug", size: "64x64" }],
    ["an over-long prompt", { prompt: "x".repeat(4001) }],
  ])("answers 400 for %s", async (_label, body) => {
    const response = await generateImage(post("/api/images/generate", body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid input" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await generateImage(post("/api/images/generate", { prompt: "a mug" }))).status).toBe(401);
  });

  it("answers 500 when the provider fails", async () => {
    generate.mockRejectedValue(new Error("quota exceeded"));
    const response = await generateImage(post("/api/images/generate", { prompt: "a mug" }));
    expect(response.status).toBe(500);
  });
});

describe("POST /api/ugc/generate", () => {
  const providerGenerate = vi.fn();
  const providerStatus = vi.fn();

  beforeEach(() => {
    llmText.mockResolvedValue("  Hey! This mug changed my mornings.  ");
    providerGenerate.mockResolvedValue({ videoId: "v_1", status: "queued" });
    providerStatus.mockResolvedValue({ videoId: "v_1", status: "completed" });
    videoProvider.mockResolvedValue({
      generate: providerGenerate,
      getStatus: providerStatus,
    } as never);
  });

  describe("action: script", () => {
    it("returns a trimmed generated script", async () => {
      const response = await ugcGenerate(
        post("/api/ugc/generate", { action: "script", productDescription: "A mug", avatarName: "Mia" })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        script: "Hey! This mug changed my mornings.",
      });
    });

    it("puts the product and creator into the prompt", async () => {
      await ugcGenerate(
        post("/api/ugc/generate", { action: "script", productDescription: "A mug", avatarName: "Mia" })
      );

      const messages = llmText.mock.calls[0][0] as { role: string; content: string }[];
      const userPrompt = messages.find((m) => m.role === "user")!.content;
      expect(userPrompt).toContain("A mug");
      expect(userPrompt).toContain("Mia");
    });

    it("falls back to a generic creator name", async () => {
      await ugcGenerate(post("/api/ugc/generate", { action: "script", productDescription: "A mug" }));

      const messages = llmText.mock.calls[0][0] as { role: string; content: string }[];
      expect(messages.find((m) => m.role === "user")!.content).toContain("the creator");
    });
  });

  describe("action: video", () => {
    it("asks the provider to generate and returns the job", async () => {
      const response = await ugcGenerate(
        post("/api/ugc/generate", {
          action: "video",
          script: "Hello",
          avatarId: "av_1",
          aspectRatio: "16:9",
        })
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ videoId: "v_1", status: "queued" });
      expect(providerGenerate).toHaveBeenCalledWith({
        script: "Hello",
        avatarId: "av_1",
        productImageUrl: undefined,
        aspectRatio: "16:9",
      });
    });

    it("defaults to a vertical aspect ratio", async () => {
      await ugcGenerate(post("/api/ugc/generate", { action: "video", script: "s", avatarId: "a" }));
      expect(providerGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: "9:16" })
      );
    });
  });

  describe("action: status", () => {
    it("polls the provider for the given video", async () => {
      const response = await ugcGenerate(
        post("/api/ugc/generate", { action: "status", videoId: "v_1" })
      );

      expect(response.status).toBe(200);
      expect(providerStatus).toHaveBeenCalledWith("v_1");
    });
  });

  it("answers 400 for an unrecognised action", async () => {
    const response = await ugcGenerate(post("/api/ugc/generate", { action: "teleport" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid action" });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await ugcGenerate(post("/api/ugc/generate", { action: "script" }))).status).toBe(401);
  });

  it("answers 500 when the provider fails", async () => {
    videoProvider.mockRejectedValue(new Error("no api key"));
    const response = await ugcGenerate(
      post("/api/ugc/generate", { action: "video", script: "s", avatarId: "a" })
    );
    expect(response.status).toBe(500);
  });
});

describe("GET /api/campaigns/[id]", () => {
  const params = { params: Promise.resolve({ id: "camp_1" }) };

  it("returns a campaign the user owns, with its assets", async () => {
    campaign.findFirst.mockResolvedValue({ id: "camp_1", assets: [] } as never);

    const response = await getCampaign(new Request("http://localhost"), params);

    expect(response.status).toBe(200);
    expect(campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp_1", userId: "user_1" } })
    );
  });

  it("answers 404 for someone else's campaign", async () => {
    campaign.findFirst.mockResolvedValue(null as never);
    expect((await getCampaign(new Request("http://localhost"), params)).status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await getCampaign(new Request("http://localhost"), params)).status).toBe(401);
  });

  it("answers 500 when the database fails", async () => {
    campaign.findFirst.mockRejectedValue(new Error("db down"));
    expect((await getCampaign(new Request("http://localhost"), params)).status).toBe(500);
  });
});
