import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  return { prisma: { user: model(), socialConnection: model() } };
});
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { GET as listConnections } from "@/app/api/settings/connections/route";
import { DELETE as deleteConnection } from "@/app/api/settings/connections/[id]/route";

const user = vi.mocked(prisma.user);
const socialConnection = vi.mocked(prisma.socialConnection);
const session = vi.mocked(requireSession);

const put = (body: unknown) =>
  new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
});

describe("GET /api/settings", () => {
  it("masks stored API keys, keeping the first and last four characters", async () => {
    user.findUnique.mockResolvedValue({
      settings: { llmProvider: "openai", llmApiKey: "sk-abcdefghijkl", imageApiKey: "sk-1234567890" },
    } as never);

    const body = await (await getSettings()).json();

    expect(body.llmApiKey).toBe("sk-a••••ijkl");
    expect(body.imageApiKey).toBe("sk-1••••7890");
    expect(body.llmProvider).toBe("openai");
  });

  it("never returns a key in the clear", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmApiKey: "sk-abcdefghijkl" } } as never);

    const body = await (await getSettings()).json();

    expect(body.llmApiKey).not.toContain("bcdefgh");
  });

  it("masks a short key completely", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmApiKey: "short" } } as never);

    expect((await (await getSettings()).json()).llmApiKey).toBe("••••");
  });

  it("returns empty strings when no keys are stored", async () => {
    user.findUnique.mockResolvedValue({ settings: null } as never);

    const body = await (await getSettings()).json();

    expect(body).toEqual({ llmApiKey: "", imageApiKey: "" });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await getSettings()).status).toBe(401);
  });

  it("answers 500 when the database fails", async () => {
    user.findUnique.mockRejectedValue(new Error("db down"));
    expect((await getSettings()).status).toBe(500);
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    user.findUnique.mockResolvedValue({
      settings: { llmProvider: "openai", llmApiKey: "sk-original", imageApiKey: "img-original" },
    } as never);
    user.update.mockResolvedValue({} as never);
  });

  const savedSettings = () =>
    (user.update.mock.calls[0][0] as { data: { settings: Record<string, unknown> } }).data.settings;

  it("stores a newly supplied key", async () => {
    await putSettings(put({ llmApiKey: "sk-brand-new" }));
    expect(savedSettings().llmApiKey).toBe("sk-brand-new");
  });

  it("keeps the stored key when the form posts back the masked placeholder", async () => {
    await putSettings(put({ llmApiKey: "sk-o••••inal" }));
    expect(savedSettings().llmApiKey).toBe("sk-original");
  });

  it("keeps the stored key when the field is submitted empty", async () => {
    await putSettings(put({ llmApiKey: "" }));
    expect(savedSettings().llmApiKey).toBe("sk-original");
  });

  it("masks and preserves the image key on the same rules", async () => {
    await putSettings(put({ imageApiKey: "img-••••inal" }));
    expect(savedSettings().imageApiKey).toBe("img-original");
  });

  it("preserves settings the request did not mention", async () => {
    await putSettings(put({ llmModel: "gpt-4o-mini" }));

    const saved = savedSettings();
    expect(saved.llmProvider).toBe("openai");
    expect(saved.llmModel).toBe("gpt-4o-mini");
  });

  it("saves against the signed-in user only", async () => {
    await putSettings(put({ llmProvider: "anthropic" }));
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user_1" } })
    );
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await putSettings(put({}))).status).toBe(401);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("answers 500 when the write fails", async () => {
    user.update.mockRejectedValue(new Error("db down"));
    expect((await putSettings(put({}))).status).toBe(500);
  });
});

describe("GET /api/settings/connections", () => {
  it("returns the user's connections without secrets", async () => {
    socialConnection.findMany.mockResolvedValue([{ id: "c1", platform: "twitter" }] as never);

    const response = await listConnections();

    expect(response.status).toBe(200);
    const select = (socialConnection.findMany.mock.calls[0][0] as { select: Record<string, boolean> })
      .select;
    expect(select).not.toHaveProperty("accessToken");
    expect(select).not.toHaveProperty("refreshToken");
    expect(socialConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } })
    );
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await listConnections()).status).toBe(401);
  });
});

describe("DELETE /api/settings/connections/[id]", () => {
  it("scopes the delete to the signed-in user", async () => {
    socialConnection.deleteMany.mockResolvedValue({ count: 1 } as never);

    const response = await deleteConnection(new Request("http://localhost"), {
      params: Promise.resolve({ id: "conn_1" }),
    });

    expect(response.status).toBe(200);
    expect(socialConnection.deleteMany).toHaveBeenCalledWith({
      where: { id: "conn_1", userId: "user_1" },
    });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    const response = await deleteConnection(new Request("http://localhost"), {
      params: Promise.resolve({ id: "conn_1" }),
    });
    expect(response.status).toBe(401);
    expect(socialConnection.deleteMany).not.toHaveBeenCalled();
  });
});
