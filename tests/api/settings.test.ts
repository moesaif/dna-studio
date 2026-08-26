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

    expect(body.settings.llmApiKey).toBe("sk-a••••ijkl");
    expect(body.settings.imageApiKey).toBe("sk-1••••7890");
    expect(body.settings.llmProvider).toBe("openai");
  });

  it("never returns a key in the clear", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmApiKey: "sk-abcdefghijkl" } } as never);

    const body = await (await getSettings()).json();

    expect(JSON.stringify(body)).not.toContain("bcdefgh");
  });

  it("masks a short key completely", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmApiKey: "short" } } as never);

    expect((await (await getSettings()).json()).settings.llmApiKey).toBe("••••");
  });

  it("returns empty strings when no keys are stored", async () => {
    user.findUnique.mockResolvedValue({ settings: null } as never);

    const body = await (await getSettings()).json();

    expect(body.settings).toEqual({ llmApiKey: "", imageApiKey: "" });
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

describe("GET /api/settings sources", () => {
  it("reports a saved key as coming from the user, without the value", async () => {
    user.findUnique.mockResolvedValue({
      settings: { llmProvider: "openai", llmApiKey: "sk-abcdefghijkl" },
    } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey).toMatchObject({ source: "user", envVar: "OPENAI_API_KEY" });
    expect(JSON.stringify(body)).not.toContain("sk-abcdefghijkl");
  });

  it("reports an environment key as coming from the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "anthropic" } } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey).toMatchObject({ source: "env", envVar: "ANTHROPIC_API_KEY" });
    expect(JSON.stringify(body)).not.toContain("sk-ant-env");
  });

  it("reports nothing configured as none", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    const body = await (await getSettings()).json();
    expect(body.sources.videoApiKey.source).toBe("none");
  });

  // The page trusts `effective` to decide which provider is selected. If the
  // API ignored LLM_PROVIDER, a self-hoster running Anthropic with no saved
  // settings saw OpenAI selected and "not configured" against OPENAI_API_KEY.
  it("reports the env-selected provider as effective", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("IMAGE_PROVIDER", "stability");
    vi.stubEnv("VIDEO_PROVIDER", "heygen");
    user.findUnique.mockResolvedValue({ settings: {} } as never);

    const body = await (await getSettings()).json();

    expect(body.effective).toEqual({
      llmProvider: "anthropic",
      imageProvider: "stability",
      videoProvider: "heygen",
    });
  });

  it("resolves sources against the env-selected provider, not OpenAI", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-env");
    user.findUnique.mockResolvedValue({ settings: {} } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey).toMatchObject({ source: "env", envVar: "ANTHROPIC_API_KEY" });
    expect(JSON.stringify(body)).not.toContain("sk-ant-env");
  });

  it("prefers the saved provider over the environment one", async () => {
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "gemini" } } as never);

    const body = await (await getSettings()).json();

    expect(body.effective.llmProvider).toBe("gemini");
  });

  it("reports the env-selected image and video keys against their own vars", async () => {
    vi.stubEnv("IMAGE_PROVIDER", "replicate");
    vi.stubEnv("REPLICATE_API_TOKEN", "r8_env");
    vi.stubEnv("VIDEO_PROVIDER", "did");
    vi.stubEnv("DID_API_KEY", "did_env");
    user.findUnique.mockResolvedValue({ settings: {} } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.imageApiKey).toMatchObject({ source: "env", envVar: "REPLICATE_API_TOKEN" });
    expect(body.sources.videoApiKey).toMatchObject({ source: "env", envVar: "DID_API_KEY" });
  });

  // A local-Ollama user with nothing set is configured, not unconfigured.
  it("reports the documented ollama default rather than 'not configured'", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.ollamaUrl).toMatchObject({
      source: "default",
      masked: "http://localhost:11434",
    });
  });

  // A base URL is configuration, not a secret: masking it renders as corruption.
  it("does not mask a url credential", async () => {
    user.findUnique.mockResolvedValue({ settings: { ollamaUrl: "http://box.local:11434" } } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.ollamaUrl).toMatchObject({
      source: "user",
      masked: "http://box.local:11434",
    });
  });

  it("still masks api-key credentials", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmApiKey: "sk-abcdefghijkl" } } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.llmApiKey.masked).toBe("sk-a••••ijkl");
  });

  it("masks a saved llm key even when the selected provider is ollama", async () => {
    user.findUnique.mockResolvedValue({
      settings: { llmProvider: "ollama", llmApiKey: "sk-abcdefghijkl" },
    } as never);

    const body = await (await getSettings()).json();

    expect(JSON.stringify(body)).not.toContain("sk-abcdefghijkl");
  });

  it("covers every credential field the registry defines", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);

    const body = await (await getSettings()).json();

    expect(Object.keys(body.sources).sort()).toEqual(
      ["imageApiKey", "llmApiKey", "ollamaUrl", "videoApiKey"]
    );
  });

  it("reports the ollama base-url credential against the ollama provider, never the selected LLM provider", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://env-ollama:11434");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-env");
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "openai" } } as never);

    const body = await (await getSettings()).json();

    expect(body.sources.ollamaUrl).toMatchObject({ source: "env", envVar: "OLLAMA_BASE_URL" });
  });
});

describe("PUT /api/settings merge", () => {
  it("persists a video provider, which the old six-field rebuild could not", async () => {
    user.findUnique.mockResolvedValue({ settings: { llmProvider: "openai" } } as never);
    user.update.mockResolvedValue({} as never);

    await putSettings(put({ videoProvider: "heygen", videoApiKey: "hg-key" }));

    const saved = (user.update.mock.calls[0][0] as unknown as {
      data: { settings: Record<string, unknown> };
    }).data.settings;
    expect(saved.videoProvider).toBe("heygen");
    expect(saved.videoApiKey).toBe("hg-key");
    expect(saved.llmProvider).toBe("openai");
  });

  it("rejects an unknown field rather than storing it", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    const response = await putSettings(put({ isAdmin: true }));
    expect(response.status).toBe(400);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects a provider id that is not in the registry", async () => {
    user.findUnique.mockResolvedValue({ settings: {} } as never);
    expect((await putSettings(put({ llmProvider: "hal9000" }))).status).toBe(400);
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
