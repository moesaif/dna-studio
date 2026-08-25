import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSettings = vi.fn();
vi.mock("@/lib/settings/resolve", () => ({ resolveSettings }));

const OpenAIImageProvider = vi.fn();
const StabilityProvider = vi.fn();
const ReplicateProvider = vi.fn();
const GeminiImageProvider = vi.fn();

vi.mock("@/lib/image/providers/openai", () => ({ OpenAIImageProvider }));
vi.mock("@/lib/image/providers/stability", () => ({ StabilityProvider }));
vi.mock("@/lib/image/providers/replicate", () => ({ ReplicateProvider }));
vi.mock("@/lib/image/providers/gemini", () => ({ GeminiImageProvider }));

const settings = (overrides: Record<string, string> = {}) => ({
  llmProvider: "openai",
  llmApiKey: "",
  llmModel: "gpt-4o",
  ollamaUrl: "http://localhost:11434",
  imageProvider: "openai",
  imageApiKey: "sk-image",
  videoProvider: "veo",
  videoApiKey: "",
  ...overrides,
});

async function freshClient() {
  vi.resetModules();
  return import("@/lib/image/client");
}

describe("getImageProvider", () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock would be treated by
    // Vitest as a teardown callback and invoked after the test.
    resolveSettings.mockResolvedValue(settings());
  });

  it.each([
    ["openai", () => OpenAIImageProvider],
    ["stability", () => StabilityProvider],
    ["replicate", () => ReplicateProvider],
    ["gemini", () => GeminiImageProvider],
  ])("builds the %s provider with the resolved key", async (provider, ctor) => {
    resolveSettings.mockResolvedValue(settings({ imageProvider: provider, imageApiKey: "key" }));
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    expect(ctor()).toHaveBeenCalledWith("key");
  });

  it("passes undefined rather than an empty key", async () => {
    resolveSettings.mockResolvedValue(settings({ imageApiKey: "" }));
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    expect(OpenAIImageProvider).toHaveBeenCalledWith(undefined);
  });

  it("rejects an unknown provider by name", async () => {
    resolveSettings.mockResolvedValue(settings({ imageProvider: "midjourney" }));
    const { getImageProvider } = await freshClient();
    await expect(getImageProvider()).rejects.toThrow("Unknown image provider: midjourney");
  });

  it("reuses the provider when nothing has changed", async () => {
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    await getImageProvider();
    expect(OpenAIImageProvider).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the key changes", async () => {
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    resolveSettings.mockResolvedValue(settings({ imageApiKey: "sk-rotated" }));
    await getImageProvider();
    expect(OpenAIImageProvider).toHaveBeenCalledTimes(2);
  });

  it("falls back to IMAGE_PROVIDER when settings cannot be resolved", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    vi.stubEnv("IMAGE_PROVIDER", "stability");
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    expect(StabilityProvider).toHaveBeenCalledWith(undefined);
  });

  it("defaults to openai when nothing is configured at all", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    const { getImageProvider } = await freshClient();
    await getImageProvider();
    expect(OpenAIImageProvider).toHaveBeenCalled();
  });
});
