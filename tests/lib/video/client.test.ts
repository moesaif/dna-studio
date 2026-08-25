import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSettings = vi.fn();
vi.mock("@/lib/settings/resolve", () => ({ resolveSettings }));

const VeoProvider = vi.fn();
const HeyGenProvider = vi.fn();
const DIDProvider = vi.fn();

vi.mock("@/lib/video/providers/veo", () => ({ VeoProvider }));
vi.mock("@/lib/video/providers/heygen", () => ({ HeyGenProvider }));
vi.mock("@/lib/video/providers/did", () => ({ DIDProvider }));

const settings = (overrides: Record<string, string> = {}) => ({
  llmProvider: "openai",
  llmApiKey: "",
  llmModel: "gpt-4o",
  ollamaUrl: "http://localhost:11434",
  imageProvider: "openai",
  imageApiKey: "",
  videoProvider: "veo",
  videoApiKey: "goog-key",
  ...overrides,
});

async function freshClient() {
  vi.resetModules();
  return import("@/lib/video/client");
}

describe("getVideoProvider", () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock would be treated by
    // Vitest as a teardown callback and invoked after the test.
    resolveSettings.mockResolvedValue(settings());
  });

  it.each([
    ["veo", () => VeoProvider],
    ["heygen", () => HeyGenProvider],
    ["did", () => DIDProvider],
  ])("builds the %s provider with the resolved key", async (provider, ctor) => {
    resolveSettings.mockResolvedValue(settings({ videoProvider: provider, videoApiKey: "key" }));
    const { getVideoProvider } = await freshClient();
    await getVideoProvider();
    expect(ctor()).toHaveBeenCalledWith("key");
  });

  it("rejects an unknown provider by name", async () => {
    resolveSettings.mockResolvedValue(settings({ videoProvider: "sora" }));
    const { getVideoProvider } = await freshClient();
    await expect(getVideoProvider()).rejects.toThrow("Unknown video provider: sora");
  });

  it("reuses the provider when nothing has changed", async () => {
    const { getVideoProvider } = await freshClient();
    await getVideoProvider();
    await getVideoProvider();
    expect(VeoProvider).toHaveBeenCalledTimes(1);
  });

  it("falls back to VIDEO_PROVIDER and the first key it finds", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    vi.stubEnv("VIDEO_PROVIDER", "heygen");
    vi.stubEnv("HEYGEN_API_KEY", "hg-env");

    const { getVideoProvider } = await freshClient();
    await getVideoProvider();
    expect(HeyGenProvider).toHaveBeenCalledWith("hg-env");
  });

  it("prefers GOOGLE_API_KEY over the other provider keys in the fallback path", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    vi.stubEnv("GOOGLE_API_KEY", "goog-env");
    vi.stubEnv("HEYGEN_API_KEY", "hg-env");

    const { getVideoProvider } = await freshClient();
    await getVideoProvider();
    expect(VeoProvider).toHaveBeenCalledWith("goog-env");
  });

  it("defaults to veo when nothing is configured at all", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    const { getVideoProvider } = await freshClient();
    await getVideoProvider();
    expect(VeoProvider).toHaveBeenCalledWith(undefined);
  });
});
