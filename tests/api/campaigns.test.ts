import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return { prisma: { campaign: model(), brand: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/llm/client", () => ({ generateJSON: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { generateJSON } from "@/lib/llm/client";
import { GET as listCampaigns } from "@/app/api/campaigns/route";
import {
  GET as getSuggestions,
  PATCH as patchSuggestion,
} from "@/app/api/campaigns/suggestions/route";
import { makeBrandDNA } from "../fixtures/brand-dna";

const campaign = vi.mocked(prisma.campaign);
const brand = vi.mocked(prisma.brand);
const session = vi.mocked(requireSession);
const llm = vi.mocked(generateJSON);

const get = (query = "") => new Request(`http://localhost/api/campaigns/suggestions${query}`);
const patch = (query: string, body: unknown) =>
  new Request(`http://localhost/api/campaigns/suggestions${query}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const SUGGESTIONS = [
  { title: "Morning ritual", description: "d", imagePrompt: "p" },
  { title: "Bean to cup", description: "d", imagePrompt: "p" },
];

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("GET /api/campaigns", () => {
  it("lists the user's campaigns newest first", async () => {
    campaign.findMany.mockResolvedValue([{ id: "c1" }] as never);

    expect((await listCampaigns()).status).toBe(200);
    expect(campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" }, orderBy: { createdAt: "desc" } })
    );
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await listCampaigns()).status).toBe(401);
  });

  it("answers 500 when the database fails", async () => {
    campaign.findMany.mockRejectedValue(new Error("db down"));
    expect((await listCampaigns()).status).toBe(500);
  });
});

describe("GET /api/campaigns/suggestions", () => {
  beforeEach(() => {
    brand.findFirst.mockResolvedValue({
      id: "brand_1",
      dna: makeBrandDNA(),
      suggestions: null,
    } as never);
    brand.update.mockResolvedValue({} as never);
    llm.mockResolvedValue({ suggestions: SUGGESTIONS } as never);
  });

  it("requires a brandId", async () => {
    const response = await getSuggestions(get(""));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "brandId is required" });
  });

  it("answers 404 for a brand the user does not own", async () => {
    brand.findFirst.mockResolvedValue(null as never);
    expect((await getSuggestions(get("?brandId=brand_1"))).status).toBe(404);
  });

  it("scopes the brand lookup to the signed-in user", async () => {
    await getSuggestions(get("?brandId=brand_1"));
    expect(brand.findFirst).toHaveBeenCalledWith({
      where: { id: "brand_1", userId: "user_1" },
    });
  });

  it("generates and caches suggestions when none are stored", async () => {
    const response = await getSuggestions(get("?brandId=brand_1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SUGGESTIONS);
    expect(brand.update).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { suggestions: SUGGESTIONS },
    });
  });

  it("serves cached suggestions without calling the model", async () => {
    brand.findFirst.mockResolvedValue({
      id: "brand_1",
      dna: makeBrandDNA(),
      suggestions: SUGGESTIONS,
    } as never);

    await expect((await getSuggestions(get("?brandId=brand_1"))).json()).resolves.toEqual(
      SUGGESTIONS
    );
    expect(llm).not.toHaveBeenCalled();
  });

  it("regenerates when refresh=true even if a cache exists", async () => {
    brand.findFirst.mockResolvedValue({
      id: "brand_1",
      dna: makeBrandDNA(),
      suggestions: SUGGESTIONS,
    } as never);

    await getSuggestions(get("?brandId=brand_1&refresh=true"));

    expect(llm).toHaveBeenCalled();
  });

  it("ignores an empty cached array and regenerates", async () => {
    brand.findFirst.mockResolvedValue({
      id: "brand_1",
      dna: makeBrandDNA(),
      suggestions: [],
    } as never);

    await getSuggestions(get("?brandId=brand_1"));

    expect(llm).toHaveBeenCalled();
  });

  it("prompts the model with the brand's own DNA", async () => {
    await getSuggestions(get("?brandId=brand_1"));

    const messages = llm.mock.calls[0][0] as { role: string; content: string }[];
    const userPrompt = messages.find((m) => m.role === "user")!.content;
    expect(userPrompt).toContain("Acme Coffee");
    expect(userPrompt).toContain("Food & Beverage");
    expect(userPrompt).toContain("#6F4E37");
  });

  it("answers 500 when generation fails", async () => {
    llm.mockRejectedValue(new Error("model unavailable"));

    const response = await getSuggestions(get("?brandId=brand_1"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to generate suggestions" });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await getSuggestions(get("?brandId=brand_1"))).status).toBe(401);
  });
});

describe("PATCH /api/campaigns/suggestions", () => {
  beforeEach(() => {
    brand.findFirst.mockResolvedValue({ id: "brand_1", suggestions: [...SUGGESTIONS] } as never);
    brand.update.mockResolvedValue({} as never);
  });

  it("attaches a generated image to one cached suggestion", async () => {
    const response = await patchSuggestion(
      patch("?brandId=brand_1", { index: 1, imageUrl: "https://cdn/img.png" }),
      );

    expect(response.status).toBe(200);
    const saved = (
      brand.update.mock.calls[0][0] as unknown as {
        data: { suggestions: { imageUrl?: string }[] };
      }
    ).data.suggestions;
    expect(saved[1].imageUrl).toBe("https://cdn/img.png");
    expect(saved[0].imageUrl).toBeUndefined();
  });

  it.each([
    ["no brandId", "", { index: 0, imageUrl: "https://cdn/i.png" }],
    ["no index", "?brandId=brand_1", { imageUrl: "https://cdn/i.png" }],
    ["no imageUrl", "?brandId=brand_1", { index: 0 }],
  ])("answers 400 with %s", async (_label, query, body) => {
    const response = await patchSuggestion(patch(query, body));
    expect(response.status).toBe(400);
    expect(brand.update).not.toHaveBeenCalled();
  });

  it("answers 404 when the brand has no cached suggestions", async () => {
    brand.findFirst.mockResolvedValue({ id: "brand_1", suggestions: null } as never);

    const response = await patchSuggestion(
      patch("?brandId=brand_1", { index: 0, imageUrl: "https://cdn/i.png" })
    );

    expect(response.status).toBe(404);
  });

  it("ignores an out-of-range index without writing", async () => {
    const response = await patchSuggestion(
      patch("?brandId=brand_1", { index: 99, imageUrl: "https://cdn/i.png" })
    );

    expect(response.status).toBe(200);
    expect(brand.update).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    const response = await patchSuggestion(
      patch("?brandId=brand_1", { index: 0, imageUrl: "https://cdn/i.png" })
    );
    expect(response.status).toBe(401);
  });
});
