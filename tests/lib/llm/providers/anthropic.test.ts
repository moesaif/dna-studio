import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, stream, ctor } = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
  ctor: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: function (options: { apiKey?: string }) {
    ctor(options);
    return { messages: { create, stream } };
  },
}));

import { AnthropicProvider } from "@/lib/llm/providers/anthropic";

const reply = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 12, output_tokens: 5 },
});

const args = (call = 0) => create.mock.calls[call][0];

beforeEach(() => {
  create.mockResolvedValue(reply("hello"));
});

describe("AnthropicProvider", () => {
  it("passes the API key to the SDK", () => {
    new AnthropicProvider("sk-ant");
    expect(ctor).toHaveBeenCalledWith({ apiKey: "sk-ant" });
  });

  it("falls back to ANTHROPIC_API_KEY", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-env");
    new AnthropicProvider();
    expect(ctor).toHaveBeenCalledWith({ apiKey: "sk-env" });
  });

  it("defaults to a Claude Sonnet model", async () => {
    await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(args().model).toBe("claude-sonnet-4-20250514");
  });

  it("prefers ANTHROPIC_MODEL, then an explicit model", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku");
    await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(args(0).model).toBe("claude-haiku");

    await new AnthropicProvider("sk", "claude-opus").generate([{ role: "user", content: "hi" }]);
    expect(args(1).model).toBe("claude-opus");
  });

  it("lifts the system message out of the message list", async () => {
    await new AnthropicProvider("sk").generate([
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
    ]);

    expect(args().system).toBe("Be terse.");
    expect(args().messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("omits the system field when there is no system message", async () => {
    await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(args()).not.toHaveProperty("system");
  });

  it("returns the text of the first content block", async () => {
    const result = await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("hello");
  });

  it("returns an empty string for a non-text content block", async () => {
    create.mockResolvedValue({
      content: [{ type: "tool_use" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("");
  });

  it("maps token usage", async () => {
    const result = await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 5 });
  });

  describe("JSON mode", () => {
    it("adds a JSON instruction to the system prompt", async () => {
      await new AnthropicProvider("sk").generate(
        [{ role: "system", content: "Be terse." }, { role: "user", content: "hi" }],
        { json: true }
      );

      expect(args().system).toContain("Be terse.");
      expect(args().system).toContain("Respond with valid JSON only");
    });

    it("works with no system message of its own", async () => {
      await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }], { json: true });
      expect(args().system).toBe("Respond with valid JSON only. No explanation, no markdown.");
    });

    it("pre-fills the assistant turn with an opening brace", async () => {
      await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }], { json: true });
      expect(args().messages).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "{" },
      ]);
    });

    it("re-attaches the prefilled brace so the result parses", async () => {
      create.mockResolvedValue(reply('"ok":true}'));

      const result = await new AnthropicProvider("sk").generate(
        [{ role: "user", content: "hi" }],
        { json: true }
      );

      expect(result.content).toBe('{"ok":true}');
      expect(JSON.parse(result.content)).toEqual({ ok: true });
    });

    it("does not prefill when JSON mode is off", async () => {
      await new AnthropicProvider("sk").generate([{ role: "user", content: "hi" }]);
      expect(args().messages).toEqual([{ role: "user", content: "hi" }]);
    });
  });

  it("yields text deltas and a final done chunk when streaming", async () => {
    stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } };
        yield { type: "message_start" };
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } };
      },
    });

    const chunks = [];
    for await (const chunk of new AnthropicProvider("sk").stream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "Hel", done: false },
      { content: "lo", done: false },
      { content: "", done: true },
    ]);
  });
});
