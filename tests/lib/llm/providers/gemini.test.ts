import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGenerativeModel, startChat, sendMessage, sendMessageStream, ctor } = vi.hoisted(() => ({
  getGenerativeModel: vi.fn(),
  startChat: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageStream: vi.fn(),
  ctor: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: function (apiKey: string) {
    ctor(apiKey);
    return { getGenerativeModel };
  },
}));

import { GeminiProvider } from "@/lib/llm/providers/gemini";

beforeEach(() => {
  sendMessage.mockResolvedValue({
    response: {
      text: () => "hello",
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
    },
  });
  startChat.mockReturnValue({ sendMessage, sendMessageStream });
  getGenerativeModel.mockReturnValue({ startChat });
});

const modelArgs = (call = 0) => getGenerativeModel.mock.calls[call][0];
const chatArgs = (call = 0) => startChat.mock.calls[call][0];

describe("GeminiProvider", () => {
  it("passes the API key to the SDK", () => {
    new GeminiProvider("goog-key");
    expect(ctor).toHaveBeenCalledWith("goog-key");
  });

  it("falls back to GOOGLE_API_KEY, then an empty string", () => {
    vi.stubEnv("GOOGLE_API_KEY", "goog-env");
    new GeminiProvider();
    expect(ctor).toHaveBeenCalledWith("goog-env");

    vi.unstubAllEnvs();
    new GeminiProvider();
    expect(ctor).toHaveBeenLastCalledWith("");
  });

  it("defaults the model, and prefers GEMINI_MODEL then an explicit one", async () => {
    await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(modelArgs(0).model).toBe("gemini-2.0-flash");

    vi.stubEnv("GEMINI_MODEL", "gemini-1.5-pro");
    await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(modelArgs(1).model).toBe("gemini-1.5-pro");

    await new GeminiProvider("k", "gemini-3").generate([{ role: "user", content: "hi" }]);
    expect(modelArgs(2).model).toBe("gemini-3");
  });

  it("applies default generation settings", async () => {
    await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(modelArgs().generationConfig).toMatchObject({
      temperature: 0.7,
      maxOutputTokens: 4096,
    });
  });

  it("requests a JSON mime type only in JSON mode", async () => {
    await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(modelArgs(0).generationConfig).not.toHaveProperty("responseMimeType");

    await new GeminiProvider("k").generate([{ role: "user", content: "hi" }], { json: true });
    expect(modelArgs(1).generationConfig.responseMimeType).toBe("application/json");
  });

  it("passes the system message as a system instruction", async () => {
    await new GeminiProvider("k").generate([
      { role: "system", content: "Be terse." },
      { role: "user", content: "hi" },
    ]);

    expect(chatArgs().systemInstruction).toEqual({
      role: "user",
      parts: [{ text: "Be terse." }],
    });
  });

  it("sends only the last message, keeping the rest as history", async () => {
    await new GeminiProvider("k").generate([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]);

    expect(chatArgs().history).toEqual([
      { role: "user", parts: [{ text: "first" }] },
      { role: "model", parts: [{ text: "reply" }] },
    ]);
    expect(sendMessage).toHaveBeenCalledWith("second");
  });

  it("returns the response text and usage", async () => {
    const result = await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 3 });
  });

  it("omits usage when the API reports none", async () => {
    sendMessage.mockResolvedValue({ response: { text: () => "hello" } });
    const result = await new GeminiProvider("k").generate([{ role: "user", content: "hi" }]);
    expect(result.usage).toBeUndefined();
  });

  it("streams non-empty chunks and ends with a done marker", async () => {
    sendMessageStream.mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { text: () => "Hel" };
          yield { text: () => "" };
          yield { text: () => "lo" };
        },
      },
    });

    const chunks = [];
    for await (const chunk of new GeminiProvider("k").stream([{ role: "user", content: "hi" }])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "Hel", done: false },
      { content: "lo", done: false },
      { content: "", done: true },
    ]);
  });
});
