import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({ findFirst: vi.fn(), create: vi.fn() });
  return { prisma: { brand: model(), campaign: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/brand-dna/crawler", () => ({ crawlBrandDNA: vi.fn() }));
vi.mock("@/lib/campaigns/generator", () => ({ streamCampaign: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { crawlBrandDNA } from "@/lib/brand-dna/crawler";
import { streamCampaign } from "@/lib/campaigns/generator";
import { POST as analyze } from "@/app/api/brands/analyze/route";
import { POST as generate } from "@/app/api/campaigns/generate/route";
import { makeBrandDNA } from "../fixtures/brand-dna";

const brand = vi.mocked(prisma.brand);
const campaign = vi.mocked(prisma.campaign);
const session = vi.mocked(requireSession);
const crawl = vi.mocked(crawlBrandDNA);
const stream = vi.mocked(streamCampaign);

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

/** Collect an SSE body into the list of decoded `data:` payloads. */
async function readEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("POST /api/brands/analyze", () => {
  const dna = makeBrandDNA();

  beforeEach(() => {
    crawl.mockResolvedValue(dna as never);
    brand.create.mockResolvedValue({ id: "brand_1", name: dna.name } as never);
  });

  it("answers 400 for a malformed URL without crawling", async () => {
    const response = await analyze(post("/api/brands/analyze", { url: "not a url" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid URL" });
    expect(crawl).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    const response = await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" }));
    expect(response.status).toBe(401);
  });

  it("responds as an event stream", async () => {
    const response = await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" }));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("forwards crawl progress and finishes with the saved brand", async () => {
    crawl.mockImplementation(async (_url, onProgress) => {
      onProgress!({ step: "fetch", status: "running" });
      onProgress!({ step: "fetch", status: "done" });
      return dna as never;
    });

    const events = await readEvents(
      await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" }))
    );

    expect(events.slice(0, 2)).toEqual([
      { type: "progress", step: "fetch", status: "running" },
      { type: "progress", step: "fetch", status: "done" },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("saves the brand against the signed-in user, flattening the DNA", async () => {
    await readEvents(await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" })));

    expect(brand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        name: "Acme Coffee",
        colors: ["#6F4E37", "#C0A080"],
        fonts: ["Playfair Display", "Inter"],
        tone: "friendly",
        industry: "Food & Beverage",
        audience: "Home brewers",
      }),
    });
  });

  it("reports a crawl failure as an error event rather than a broken stream", async () => {
    crawl.mockRejectedValue(new Error("site unreachable"));

    const events = await readEvents(
      await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" }))
    );

    expect(events).toEqual([{ type: "error", message: "site unreachable" }]);
    expect(brand.create).not.toHaveBeenCalled();
  });

  it("reports a save failure as an error event", async () => {
    brand.create.mockRejectedValue(new Error("db down"));

    const events = await readEvents(
      await analyze(post("/api/brands/analyze", { url: "https://acme.coffee" }))
    );

    expect(events.at(-1)).toEqual({ type: "error", message: "db down" });
  });
});

describe("POST /api/campaigns/generate", () => {
  const validBody = {
    brandId: "brand_1",
    goal: "Launch cold brew",
    platforms: ["instagram"],
  };

  const CONCEPTS = {
    concepts: [
      {
        name: "Morning ritual",
        assets: [
          { platform: "instagram", caption: "Hi", hashtags: ["coffee"], imagePrompt: "a mug" },
        ],
      },
    ],
  };

  beforeEach(() => {
    brand.findFirst.mockResolvedValue({ id: "brand_1", dna: makeBrandDNA() } as never);
    campaign.create.mockResolvedValue({ id: "camp_1", assets: [] } as never);
    stream.mockImplementation(async function* () {
      yield JSON.stringify(CONCEPTS);
    } as never);
  });

  it.each([
    ["a missing goal", { brandId: "brand_1", platforms: ["instagram"] }],
    ["an empty goal", { ...validBody, goal: "" }],
    ["an unsupported platform", { ...validBody, platforms: ["myspace"] }],
  ])("answers 400 for %s", async (_label, body) => {
    const response = await generate(post("/api/campaigns/generate", body));
    expect(response.status).toBe(400);
  });

  it("answers 404 for a brand the user does not own", async () => {
    brand.findFirst.mockResolvedValue(null as never);
    const response = await generate(post("/api/campaigns/generate", validBody));
    expect(response.status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await generate(post("/api/campaigns/generate", validBody))).status).toBe(401);
  });

  it("streams model chunks then the saved campaign", async () => {
    stream.mockImplementation(async function* () {
      yield '{"concepts":';
      yield JSON.stringify(CONCEPTS.concepts) + "}";
    } as never);

    const events = await readEvents(await generate(post("/api/campaigns/generate", validBody)));

    expect(events.filter((e) => e.type === "chunk")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("creates one asset per concept asset", async () => {
    await readEvents(await generate(post("/api/campaigns/generate", validBody)));

    expect(campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandId: "brand_1",
          userId: "user_1",
          goal: "Launch cold brew",
          assets: {
            create: [
              {
                platform: "instagram",
                caption: "Hi",
                hashtags: ["coffee"],
                imagePrompt: "a mug",
                status: "draft",
              },
            ],
          },
        }),
      })
    );
  });

  it("stores a null image prompt when the model omits one", async () => {
    stream.mockImplementation(async function* () {
      yield JSON.stringify({
        concepts: [
          { name: "n", assets: [{ platform: "instagram", caption: "Hi", hashtags: [] }] },
        ],
      });
    } as never);

    await readEvents(await generate(post("/api/campaigns/generate", validBody)));

    const created = campaign.create.mock.calls[0][0] as unknown as {
      data: { assets: { create: { imagePrompt: string | null }[] } };
    };
    expect(created.data.assets.create[0].imagePrompt).toBeNull();
  });

  it("reports an error event when the model returns no JSON", async () => {
    stream.mockImplementation(async function* () {
      yield "I cannot help with that.";
    } as never);

    const events = await readEvents(await generate(post("/api/campaigns/generate", validBody)));

    expect(events.at(-1)).toEqual({
      type: "error",
      message: "LLM did not return valid JSON for campaign",
    });
    expect(campaign.create).not.toHaveBeenCalled();
  });

  it("defaults the language to English", async () => {
    await readEvents(await generate(post("/api/campaigns/generate", validBody)));
    expect(stream).toHaveBeenCalledWith(expect.anything(), "Launch cold brew", ["instagram"], "English");
  });

  it("passes a requested language through", async () => {
    await readEvents(
      await generate(post("/api/campaigns/generate", { ...validBody, language: "Arabic" }))
    );
    expect(stream).toHaveBeenCalledWith(expect.anything(), "Launch cold brew", ["instagram"], "Arabic");
  });
});
