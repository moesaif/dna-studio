import { describe, expect, it } from "vitest";
import { resolveCredential } from "@/lib/settings/resolve";

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

  it("reports none for an unknown provider rather than throwing", () => {
    expect(resolveCredential("llmApiKey", "hal9000", {}, {}).origin).toBe("none");
  });
});
