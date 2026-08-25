import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSettings = vi.fn();
vi.mock("@/lib/settings/resolve", () => ({ resolveSettings }));

const OpenAIProvider = vi.fn();
const AnthropicProvider = vi.fn();
const OllamaProvider = vi.fn();
const GeminiProvider = vi.fn();

vi.mock("@/lib/llm/providers/openai", () => ({ OpenAIProvider }));
vi.mock("@/lib/llm/providers/anthropic", () => ({ AnthropicProvider }));
vi.mock("@/lib/llm/providers/ollama", () => ({ OllamaProvider }));
vi.mock("@/lib/llm/providers/gemini", () => ({ GeminiProvider }));

const settings = (overrides: Record<string, string> = {}) => ({
  llmProvider: "openai",
  llmApiKey: "sk-test",
  llmModel: "gpt-4o",
  ollamaUrl: "http://localhost:11434",
  imageProvider: "openai",
  imageApiKey: "",
  videoProvider: "veo",
  videoApiKey: "",
  ...overrides,
});

// client.ts memoises the provider at module scope, so each test needs a fresh
// module registry to avoid inheriting the previous test's cached provider.
async function freshClient() {
  vi.resetModules();
  return import("@/lib/llm/client");
}

describe("getLLMProvider", () => {
  beforeEach(() => {
    resolveSettings.mockResolvedValue(settings());
  });

  it("builds the provider named in the resolved settings", async () => {
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();
    expect(OpenAIProvider).toHaveBeenCalledWith("sk-test", "gpt-4o");
  });

  it.each([
    ["anthropic", () => AnthropicProvider],
    ["gemini", () => GeminiProvider],
  ])("builds the %s provider with the resolved key and model", async (provider, ctor) => {
    resolveSettings.mockResolvedValue(
      settings({ llmProvider: provider, llmApiKey: "key", llmModel: "model" })
    );
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();
    expect(ctor()).toHaveBeenCalledWith("key", "model");
  });

  it("builds ollama with the base URL rather than an API key", async () => {
    resolveSettings.mockResolvedValue(
      settings({ llmProvider: "ollama", llmApiKey: "", ollamaUrl: "http://ollama:11434", llmModel: "llama3.1" })
    );
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();
    expect(OllamaProvider).toHaveBeenCalledWith("http://ollama:11434", "llama3.1");
  });

  it("rejects an unknown provider by name", async () => {
    resolveSettings.mockResolvedValue(settings({ llmProvider: "hal9000" }));
    const { getLLMProvider } = await freshClient();
    await expect(getLLMProvider()).rejects.toThrow("Unknown LLM provider: hal9000");
  });

  it("reuses the provider when the settings have not changed", async () => {
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();
    await getLLMProvider();
    expect(OpenAIProvider).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the provider when the API key changes", async () => {
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();

    resolveSettings.mockResolvedValue(settings({ llmApiKey: "sk-rotated" }));
    await getLLMProvider();

    expect(OpenAIProvider).toHaveBeenCalledTimes(2);
    expect(OpenAIProvider).toHaveBeenLastCalledWith("sk-rotated", "gpt-4o");
  });

  it("rebuilds the provider when the model changes", async () => {
    const { getLLMProvider } = await freshClient();
    await getLLMProvider();

    resolveSettings.mockResolvedValue(settings({ llmModel: "gpt-4o-mini" }));
    await getLLMProvider();

    expect(OpenAIProvider).toHaveBeenCalledTimes(2);
  });

  it("falls back to LLM_PROVIDER when settings cannot be resolved", async () => {
    resolveSettings.mockRejectedValue(new Error("no session"));
    vi.stubEnv("LLM_PROVIDER", "anthropic");

    const { getLLMProvider } = await freshClient();
    await getLLMProvider();

    expect(AnthropicProvider).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe("generateText", () => {
  it("returns just the content of the provider response", async () => {
    resolveSettings.mockResolvedValue(settings());
    const generate = vi.fn().mockResolvedValue({ content: "hello" });
    OpenAIProvider.mockImplementation(function () {
      return { generate };
    });

    const { generateText } = await freshClient();
    await expect(generateText([{ role: "user", content: "hi" }])).resolves.toBe("hello");
    expect(generate).toHaveBeenCalledWith([{ role: "user", content: "hi" }], undefined);
  });
});

describe("streamText", () => {
  it("yields the content of each chunk", async () => {
    resolveSettings.mockResolvedValue(settings());
    OpenAIProvider.mockImplementation(function () {
      return {
        async *stream() {
          yield { content: "Hel", done: false };
          yield { content: "lo", done: true };
        },
      };
    });

    const { streamText } = await freshClient();
    const chunks: string[] = [];
    for await (const chunk of streamText([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });
});

describe("generateJSON", () => {
  const respondWith = (content: string) => {
    resolveSettings.mockResolvedValue(settings());
    OpenAIProvider.mockImplementation(function () {
      return { generate: vi.fn().mockResolvedValue({ content }) };
    });
  };

  it("parses a plain JSON response", async () => {
    respondWith('{"concepts":[{"name":"Launch"}]}');
    const { generateJSON } = await freshClient();
    await expect(generateJSON([])).resolves.toEqual({ concepts: [{ name: "Launch" }] });
  });

  it("digs the object out of a fenced code block", async () => {
    respondWith('Sure!\n```json\n{"ok":true}\n```\nHope that helps.');
    const { generateJSON } = await freshClient();
    await expect(generateJSON([])).resolves.toEqual({ ok: true });
  });

  it("asks the provider for JSON at temperature 0", async () => {
    const generate = vi.fn().mockResolvedValue({ content: "{}" });
    resolveSettings.mockResolvedValue(settings());
    OpenAIProvider.mockImplementation(function () {
      return { generate };
    });

    const { generateJSON } = await freshClient();
    await generateJSON([{ role: "user", content: "hi" }]);

    expect(generate).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      expect.objectContaining({ json: true, temperature: 0 })
    );
  });

  it("lets an explicit temperature through", async () => {
    const generate = vi.fn().mockResolvedValue({ content: "{}" });
    resolveSettings.mockResolvedValue(settings());
    OpenAIProvider.mockImplementation(function () {
      return { generate };
    });

    const { generateJSON } = await freshClient();
    await generateJSON([], { temperature: 0.4 });

    expect(generate).toHaveBeenCalledWith([], expect.objectContaining({ temperature: 0.4 }));
  });

  it("throws with a snippet of the response when there is no JSON at all", async () => {
    respondWith("I cannot help with that request.");
    const { generateJSON } = await freshClient();
    await expect(generateJSON([])).rejects.toThrow(/did not return valid JSON/);
    await expect(generateJSON([])).rejects.toThrow(/I cannot help with that request/);
  });

  it("throws when the extracted text is not parseable JSON", async () => {
    respondWith("{not json at all}");
    const { generateJSON } = await freshClient();
    await expect(generateJSON([])).rejects.toThrow();
  });
});
