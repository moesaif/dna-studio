import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queueAdd, queueClose, queueCtor } = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueClose: vi.fn(),
  queueCtor: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({ findFirst: vi.fn(), update: vi.fn() });
  return { prisma: { campaign: model(), asset: model(), socialConnection: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: function (name: string, options: unknown) {
    queueCtor(name, options);
    return { add: queueAdd, close: queueClose };
  },
}));
vi.mock("@/lib/social/meta", () => ({
  publishToFacebook: vi.fn(),
  publishToInstagram: vi.fn(),
}));
vi.mock("@/lib/social/twitter", () => ({ publishToTwitter: vi.fn() }));
vi.mock("@/lib/social/linkedin", () => ({ publishToLinkedIn: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { publishToFacebook, publishToInstagram } from "@/lib/social/meta";
import { publishToTwitter } from "@/lib/social/twitter";
import { publishToLinkedIn } from "@/lib/social/linkedin";
import { POST as schedule } from "@/app/api/campaigns/[id]/schedule/route";
import { POST as publish } from "@/app/api/campaigns/[id]/publish/route";

const campaign = vi.mocked(prisma.campaign);
const asset = vi.mocked(prisma.asset);
const connection = vi.mocked(prisma.socialConnection);
const session = vi.mocked(requireSession);

const params = { params: Promise.resolve({ id: "camp_1" }) };
const post = (body: unknown) =>
  new Request("http://localhost/api/campaigns/camp_1", {
    method: "POST",
    body: JSON.stringify(body),
  });

const makeAsset = (overrides: Record<string, unknown> = {}) => ({
  id: "asset_1",
  platform: "twitter",
  caption: "Hello",
  hashtags: ["coffee"],
  imageUrl: null,
  ...overrides,
});

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
  asset.update.mockResolvedValue({} as never);
});

describe("POST /api/campaigns/[id]/schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
    campaign.findFirst.mockResolvedValue({ id: "camp_1", assets: [makeAsset()] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const future = "2026-08-25T13:00:00.000Z";

  it("queues a delayed job per asset and marks it scheduled", async () => {
    const response = await schedule(post({ assetIds: ["asset_1"], scheduledAt: future }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ scheduled: 1 });

    expect(queueAdd).toHaveBeenCalledWith(
      "publish",
      { assetId: "asset_1", campaignId: "camp_1", userId: "user_1" },
      { delay: 3_600_000, removeOnComplete: true }
    );
    expect(asset.update).toHaveBeenCalledWith({
      where: { id: "asset_1" },
      data: { status: "scheduled", scheduledAt: new Date(future) },
    });
  });

  it("closes the queue connection when it is done", async () => {
    await schedule(post({ assetIds: ["asset_1"], scheduledAt: future }), params);
    expect(queueClose).toHaveBeenCalled();
  });

  it("connects to the redis instance named in REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", "redis://redis-host:6380");
    await schedule(post({ assetIds: ["asset_1"], scheduledAt: future }), params);

    expect(queueCtor).toHaveBeenCalledWith(
      "social-publish",
      expect.objectContaining({ connection: { host: "redis-host", port: 6380 } })
    );
  });

  it("refuses a time in the past", async () => {
    const response = await schedule(
      post({ assetIds: ["asset_1"], scheduledAt: "2026-08-25T11:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Scheduled time must be in the future",
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed timestamp", async () => {
    const response = await schedule(
      post({ assetIds: ["asset_1"], scheduledAt: "next tuesday" }),
      params
    );
    expect(response.status).toBe(400);
  });

  it("answers 404 for a campaign the user does not own", async () => {
    campaign.findFirst.mockResolvedValue(null as never);
    const response = await schedule(post({ assetIds: ["asset_1"], scheduledAt: future }), params);
    expect(response.status).toBe(404);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("only schedules assets that belong to the campaign", async () => {
    await schedule(post({ assetIds: ["asset_1", "not_mine"], scheduledAt: future }), params);

    expect(campaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "camp_1", userId: "user_1" },
        include: { assets: { where: { id: { in: ["asset_1", "not_mine"] } } } },
      })
    );
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await schedule(post({ assetIds: [], scheduledAt: future }), params)).status).toBe(401);
  });
});

describe("POST /api/campaigns/[id]/publish", () => {
  beforeEach(() => {
    connection.findFirst.mockResolvedValue({
      accessToken: "token",
      refreshToken: "secret",
      accountId: "acct_1",
    } as never);
    vi.mocked(publishToTwitter).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(publishToFacebook).mockResolvedValue({ id: "f1" } as never);
    vi.mocked(publishToInstagram).mockResolvedValue({ id: "i1" } as never);
    vi.mocked(publishToLinkedIn).mockResolvedValue({ id: "l1" } as never);
  });

  it("publishes a tweet and marks the asset published", async () => {
    campaign.findFirst.mockResolvedValue({ id: "camp_1", assets: [makeAsset()] } as never);

    const response = await publish(post({ assetIds: ["asset_1"] }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ assetId: "asset_1", status: "published", result: { id: "t1" } }],
    });
    expect(asset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "published" }) })
    );
  });

  it("appends hashtags to the caption", async () => {
    campaign.findFirst.mockResolvedValue({
      id: "camp_1",
      assets: [makeAsset({ hashtags: ["coffee", "mugs"] })],
    } as never);

    await publish(post({ assetIds: ["asset_1"] }), params);

    expect(vi.mocked(publishToTwitter).mock.calls[0][0].text).toBe("Hello\n\n#coffee #mugs");
  });

  it("truncates a tweet to 280 characters", async () => {
    campaign.findFirst.mockResolvedValue({
      id: "camp_1",
      assets: [makeAsset({ caption: "x".repeat(400) })],
    } as never);

    await publish(post({ assetIds: ["asset_1"] }), params);

    expect(vi.mocked(publishToTwitter).mock.calls[0][0].text).toHaveLength(280);
  });

  it.each([
    ["facebook", () => publishToFacebook],
    ["instagram", () => publishToInstagram],
    ["linkedin", () => publishToLinkedIn],
  ])("routes a %s asset to its publisher", async (platform, publisher) => {
    campaign.findFirst.mockResolvedValue({
      id: "camp_1",
      assets: [makeAsset({ platform, imageUrl: "https://cdn/i.png" })],
    } as never);

    await publish(post({ assetIds: ["asset_1"] }), params);

    expect(publisher()).toHaveBeenCalled();
  });

  it("reports a missing connection without calling any publisher", async () => {
    campaign.findFirst.mockResolvedValue({ id: "camp_1", assets: [makeAsset()] } as never);
    connection.findFirst.mockResolvedValue(null as never);

    const body = await (await publish(post({ assetIds: ["asset_1"] }), params)).json();

    expect(body.results).toEqual([
      { assetId: "asset_1", status: "failed", error: "No twitter account connected" },
    ]);
    expect(publishToTwitter).not.toHaveBeenCalled();
    expect(asset.update).not.toHaveBeenCalled();
  });

  it("marks the asset failed and keeps going when a publisher throws", async () => {
    campaign.findFirst.mockResolvedValue({
      id: "camp_1",
      assets: [makeAsset({ id: "a1" }), makeAsset({ id: "a2" })],
    } as never);
    vi.mocked(publishToTwitter)
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ id: "t2" } as never);

    const body = await (await publish(post({ assetIds: ["a1", "a2"] }), params)).json();

    expect(body.results[0]).toEqual({ assetId: "a1", status: "failed", error: "rate limited" });
    expect(body.results[1]).toMatchObject({ assetId: "a2", status: "published" });
    expect(asset.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "failed" } });
  });

  it("looks up the connection for the signed-in user and the asset's platform", async () => {
    campaign.findFirst.mockResolvedValue({ id: "camp_1", assets: [makeAsset()] } as never);

    await publish(post({ assetIds: ["asset_1"] }), params);

    expect(connection.findFirst).toHaveBeenCalledWith({
      where: { userId: "user_1", platform: "twitter" },
    });
  });

  it("answers 404 for a campaign the user does not own", async () => {
    campaign.findFirst.mockResolvedValue(null as never);
    expect((await publish(post({ assetIds: ["asset_1"] }), params)).status).toBe(404);
  });

  it("answers 400 when assetIds is not an array", async () => {
    expect((await publish(post({ assetIds: "asset_1" }), params)).status).toBe(400);
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await publish(post({ assetIds: [] }), params)).status).toBe(401);
  });
});
