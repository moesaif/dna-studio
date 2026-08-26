import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const getSession = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth/session", () => ({ getSession }));

const { resolveSettings } = await import("@/lib/settings/resolve");

const signedIn = (settings: unknown) => {
  getSession.mockResolvedValue({ user: { id: "user_1" } });
  findUnique.mockResolvedValue({ settings });
};

describe("resolveSettings", () => {
  beforeEach(() => {
    getSession.mockResolvedValue(null);
    findUnique.mockResolvedValue(null);
  });

  describe("with no user settings and no environment", () => {
    it("falls back to documented defaults", async () => {
      await expect(resolveSettings()).resolves.toEqual({
        llmProvider: "openai",
        llmApiKey: "",
        llmModel: "gpt-4o",
        ollamaUrl: "http://localhost:11434",
        imageProvider: "openai",
        imageApiKey: "",
        videoProvider: "veo",
        videoApiKey: "",
      });
    });
  });

  describe("environment variables", () => {
    it("selects the provider from LLM_PROVIDER", async () => {
      vi.stubEnv("LLM_PROVIDER", "anthropic");
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");

      const settings = await resolveSettings();
      expect(settings.llmProvider).toBe("anthropic");
      expect(settings.llmApiKey).toBe("sk-ant-env");
      expect(settings.llmModel).toBe("claude-sonnet-4-20250514");
    });

    it("picks the API key matching the selected LLM provider", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");
      vi.stubEnv("GOOGLE_API_KEY", "goog");
      vi.stubEnv("LLM_PROVIDER", "gemini");

      expect((await resolveSettings()).llmApiKey).toBe("goog");
    });

    it("leaves the key empty for ollama, which needs none", async () => {
      vi.stubEnv("LLM_PROVIDER", "ollama");
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");

      const settings = await resolveSettings();
      expect(settings.llmApiKey).toBe("");
      expect(settings.llmModel).toBe("llama3.1");
    });

    // Regression: the credential lookup keys off the SELECTED provider, and
    // "llm" covers both llmApiKey and ollamaUrl. Resolving llmApiKey against
    // ollama once returned OLLAMA_BASE_URL as if it were an API key, which
    // every Docker deployment would hit (docker-compose always sets it) and
    // which the sibling case above cannot see, because the suite deletes
    // OLLAMA_BASE_URL before each run.
    it("still leaves the key empty for ollama when OLLAMA_BASE_URL is set", async () => {
      vi.stubEnv("LLM_PROVIDER", "ollama");
      vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");

      const settings = await resolveSettings();
      expect(settings.llmApiKey).toBe("");
      expect(settings.ollamaUrl).toBe("http://ollama:11434");
    });

    it("honours per-provider model overrides", async () => {
      vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
      expect((await resolveSettings()).llmModel).toBe("gpt-4o-mini");
    });

    it("resolves the image provider key independently of the LLM one", async () => {
      vi.stubEnv("IMAGE_PROVIDER", "replicate");
      vi.stubEnv("REPLICATE_API_TOKEN", "r8_token");
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");

      const settings = await resolveSettings();
      expect(settings.imageProvider).toBe("replicate");
      expect(settings.imageApiKey).toBe("r8_token");
      expect(settings.llmApiKey).toBe("sk-openai");
    });

    it("maps each image provider to its own key", async () => {
      vi.stubEnv("STABILITY_API_KEY", "sk-stability");
      vi.stubEnv("IMAGE_PROVIDER", "stability");
      expect((await resolveSettings()).imageApiKey).toBe("sk-stability");
    });

    it("maps each video provider to its own key", async () => {
      vi.stubEnv("HEYGEN_API_KEY", "hg");
      vi.stubEnv("DID_API_KEY", "did");
      vi.stubEnv("GOOGLE_API_KEY", "goog");

      vi.stubEnv("VIDEO_PROVIDER", "heygen");
      expect((await resolveSettings()).videoApiKey).toBe("hg");

      vi.stubEnv("VIDEO_PROVIDER", "did");
      expect((await resolveSettings()).videoApiKey).toBe("did");

      vi.stubEnv("VIDEO_PROVIDER", "veo");
      expect((await resolveSettings()).videoApiKey).toBe("goog");
    });

    it("uses OLLAMA_BASE_URL when set", async () => {
      vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");
      expect((await resolveSettings()).ollamaUrl).toBe("http://ollama:11434");
    });
  });

  describe("user settings take priority over the environment", () => {
    it("overrides provider, key and model", async () => {
      vi.stubEnv("LLM_PROVIDER", "openai");
      vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
      signedIn({ llmProvider: "anthropic", llmApiKey: "sk-from-db", llmModel: "claude-opus-4" });

      const settings = await resolveSettings();
      expect(settings.llmProvider).toBe("anthropic");
      expect(settings.llmApiKey).toBe("sk-from-db");
      expect(settings.llmModel).toBe("claude-opus-4");
    });

    it("falls back to the environment for fields the user has not set", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env");
      signedIn({ llmProvider: "anthropic" });

      const settings = await resolveSettings();
      expect(settings.llmApiKey).toBe("sk-ant-env");
      expect(settings.llmModel).toBe("claude-sonnet-4-20250514");
    });

    it("looks the settings up for the signed-in user", async () => {
      signedIn({ llmProvider: "ollama" });
      await resolveSettings();

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "user_1" },
        select: { settings: true },
      });
    });

    it("ignores a null settings column", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");
      signedIn(null);

      expect((await resolveSettings()).llmApiKey).toBe("sk-openai");
    });
  });

  describe("when the session or database is unavailable", () => {
    it("does not query the database for an anonymous request", async () => {
      getSession.mockResolvedValue(null);
      await resolveSettings();
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("falls back to the environment when the session lookup throws", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");
      getSession.mockRejectedValue(new Error("no request context"));

      expect((await resolveSettings()).llmApiKey).toBe("sk-openai");
    });

    it("falls back to the environment when the database is down", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-openai");
      getSession.mockResolvedValue({ user: { id: "user_1" } });
      findUnique.mockRejectedValue(new Error("connection refused"));

      expect((await resolveSettings()).llmApiKey).toBe("sk-openai");
    });
  });
});
