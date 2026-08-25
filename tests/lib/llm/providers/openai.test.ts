import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, ctor } = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }));

vi.mock("openai", () => ({
  default: function (options: { apiKey?: string }) {
    ctor(options);
    return { chat: { completions: { create } } };
  },
}));

import { OpenAIProvider } from "@/lib/llm/providers/openai";

const completion = (content: string | null, usage?: object) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage,
});

beforeEach(() => {
  create.mockResolvedValue(completion("hello"));
});

describe("OpenAIProvider", () => {
  it("passes the API key to the SDK", () => {
    new OpenAIProvider("sk-explicit");
    expect(ctor).toHaveBeenCalledWith({ apiKey: "sk-explicit" });
  });

  it("falls back to OPENAI_API_KEY", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    new OpenAIProvider();
    expect(ctor).toHaveBeenCalledWith({ apiKey: "sk-env" });
  });

  it("defaults the model to gpt-4o", async () => {
    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
  });

  it("prefers OPENAI_MODEL over the default", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });

  it("prefers an explicit model over the environment", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    await new OpenAIProvider("sk", "gpt-5").generate([{ role: "user", content: "hi" }]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5" }));
  });

  it("returns the message content", async () => {
    await expect(
      new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }])
    ).resolves.toMatchObject({ content: "hello" });
  });

  it("returns an empty string when the model returns no content", async () => {
    create.mockResolvedValue(completion(null));
    const result = await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("");
  });

  it("maps token usage when the API reports it", async () => {
    create.mockResolvedValue(completion("hi", { prompt_tokens: 10, completion_tokens: 4 }));
    const result = await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 4 });
  });

  it("omits usage when the API does not report it", async () => {
    const result = await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.usage).toBeUndefined();
  });

  it("applies default temperature and token limits", async () => {
    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7, max_tokens: 4096 })
    );
  });

  it("honours explicit options", async () => {
    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }], {
      temperature: 0.1,
      maxTokens: 100,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1, max_tokens: 100 })
    );
  });

  it("requests JSON mode only when asked", async () => {
    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(create.mock.calls[0][0]).not.toHaveProperty("response_format");

    await new OpenAIProvider("sk").generate([{ role: "user", content: "hi" }], { json: true });
    expect(create.mock.calls[1][0]).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  it("streams the deltas the API sends, skipping empty ones", async () => {
    create.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Hel" }, finish_reason: null }] };
        yield { choices: [{ delta: { content: "" }, finish_reason: null }] };
        yield { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] };
      },
    });

    const chunks = [];
    for await (const chunk of new OpenAIProvider("sk").stream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "Hel", done: false },
      { content: "lo", done: true },
    ]);
  });

  it("asks for a stream when streaming", async () => {
    create.mockResolvedValue({ async *[Symbol.asyncIterator]() {} });
    const iterator = new OpenAIProvider("sk").stream([{ role: "user", content: "hi" }]);
    await iterator.next();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
  });
});
