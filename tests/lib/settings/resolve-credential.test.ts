import { describe, expect, it } from "vitest";
import { resolveCredential, resolveCredentialWithDefault, resolveProviders } from "@/lib/settings/resolve";

describe("resolveCredential", () => {
  it("prefers a value the user saved", () => {
    expect(resolveCredential("llmApiKey", "openai", { llmApiKey: "sk-user" }, { OPENAI_API_KEY: "sk-env" }))
      .toEqual({ value: "sk-user", origin: "user", envVar: "OPENAI_API_KEY" });
  });

  it("falls back to the provider's own environment variable", () => {
    expect(resolveCredential("llmApiKey", "anthropic", {}, { ANTHROPIC_API_KEY: "sk-ant" }))
      .toEqual({ value: "sk-ant", origin: "env", envVar: "ANTHROPIC_API_KEY" });
  });

  it("does not borrow another provider's key", () => {
    expect(resolveCredential("llmApiKey", "anthropic", {}, { OPENAI_API_KEY: "sk-openai" }).origin)
      .toBe("none");
  });

  // The rule the UI must not overstate: image does NOT inherit a saved text key.
  it("does not inherit a saved llm key into the image field", () => {
    expect(resolveCredential("imageApiKey", "openai", { llmApiKey: "sk-user-text" }, {}).origin)
      .toBe("none");
  });

  it("does inherit the shared env var when both providers use it", () => {
    expect(resolveCredential("imageApiKey", "openai", {}, { OPENAI_API_KEY: "sk-env" }))
      .toEqual({ value: "sk-env", origin: "env", envVar: "OPENAI_API_KEY" });
  });

  it("reports none when nothing is configured", () => {
    expect(resolveCredential("videoApiKey", "heygen", {}, {}))
      .toEqual({ value: "", origin: "none", envVar: "HEYGEN_API_KEY" });
  });

  it("resolves the ollama url like any other credential", () => {
    expect(resolveCredential("ollamaUrl", "ollama", {}, { OLLAMA_BASE_URL: "http://ollama:11434" }))
      .toEqual({ value: "http://ollama:11434", origin: "env", envVar: "OLLAMA_BASE_URL" });
  });

  // The "llm" kind holds two different credential fields. Taking the selected
  // provider's env var without checking it backs THIS field handed back the
  // Ollama base URL as an API key.
  it("does not report an env var that backs a different field of the same kind", () => {
    expect(resolveCredential("llmApiKey", "ollama", {}, { OLLAMA_BASE_URL: "http://ollama:11434" }))
      .toEqual({ value: "", origin: "none", envVar: undefined });
  });

  it("does not report an api-key env var against the ollama url field", () => {
    expect(resolveCredential("ollamaUrl", "openai", {}, { OPENAI_API_KEY: "sk-openai" }))
      .toEqual({ value: "", origin: "none", envVar: undefined });
  });

  it("reports none for an unknown provider rather than throwing", () => {
    expect(resolveCredential("llmApiKey", "hal9000", {}, {}).origin).toBe("none");
  });
});

describe("resolveCredentialWithDefault", () => {
  it("falls back to the documented ollama base url", () => {
    expect(resolveCredentialWithDefault("ollamaUrl", "ollama", {}, {}))
      .toEqual({ value: "http://localhost:11434", origin: "default", envVar: "OLLAMA_BASE_URL" });
  });

  it("does not invent a default for any other field", () => {
    expect(resolveCredentialWithDefault("llmApiKey", "openai", {}, {}).origin).toBe("none");
  });

  it("leaves a configured value alone", () => {
    expect(resolveCredentialWithDefault("ollamaUrl", "ollama", { ollamaUrl: "http://box:11434" }, {}))
      .toEqual({ value: "http://box:11434", origin: "user", envVar: "OLLAMA_BASE_URL" });
  });
});

describe("resolveProviders", () => {
  it("prefers the user's saved choice", () => {
    expect(resolveProviders({ llmProvider: "anthropic" }, { LLM_PROVIDER: "gemini" }).llmProvider)
      .toBe("anthropic");
  });

  it("falls back to the documented environment variables", () => {
    expect(resolveProviders({}, { LLM_PROVIDER: "anthropic", IMAGE_PROVIDER: "stability", VIDEO_PROVIDER: "heygen" }))
      .toEqual({ llmProvider: "anthropic", imageProvider: "stability", videoProvider: "heygen" });
  });

  it("falls back to the defaults when nothing is set", () => {
    expect(resolveProviders({}, {}))
      .toEqual({ llmProvider: "openai", imageProvider: "openai", videoProvider: "veo" });
  });
});
