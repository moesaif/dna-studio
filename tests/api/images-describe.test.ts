import { beforeEach, describe, expect, it, vi } from "vitest";

const { openAICreate, anthropicCreate, generateContent, getGenerativeModel, llmGenerate } =
  vi.hoisted(() => ({
    openAICreate: vi.fn(),
    anthropicCreate: vi.fn(),
    generateContent: vi.fn(),
    getGenerativeModel: vi.fn(),
    llmGenerate: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/settings/resolve", () => ({ resolveSettings: vi.fn() }));
vi.mock("openai", () => ({
  default: function () {
    return { chat: { completions: { create: openAICreate } } };
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: function () {
    return { messages: { create: anthropicCreate } };
  },
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: function () {
    return { getGenerativeModel };
  },
}));
vi.mock("@/lib/llm/client", () => ({
  getLLMProvider: vi.fn(async () => ({ generate: llmGenerate })),
}));

import { requireSession } from "@/lib/auth/session";
import { resolveSettings } from "@/lib/settings/resolve";
import { POST as describeImage } from "@/app/api/images/describe/route";

const session = vi.mocked(requireSession);
const settings = vi.mocked(resolveSettings);

const DATA_URL = "data:image/png;base64,AAAABBBB";
const HTTP_URL = "https://cdn/product.png";

const post = (body: unknown) =>
  new Request("http://localhost/api/images/describe", {
    method: "POST",
    body: JSON.stringify(body),
  });

const withProvider = (llmProvider: string) =>
  settings.mockResolvedValue({
    llmProvider,
    llmApiKey: "key",
    llmModel: "",
  } as never);

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "user_1", email: "a@b.c" } } as never);
  withProvider("openai");
  openAICreate.mockResolvedValue({ choices: [{ message: { content: "A white ceramic mug" } }] });
  anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "A white ceramic mug" }] });
  generateContent.mockResolvedValue({ response: { text: () => "A white ceramic mug" } });
  getGenerativeModel.mockReturnValue({ generateContent });
  llmGenerate.mockResolvedValue({ content: "Please describe your product in text." });
});

describe("POST /api/images/describe", () => {
  it("requires an imageUrl", async () => {
    const response = await describeImage(post({}));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid input" });
  });

  it("answers 401 when signed out", async () => {
    session.mockRejectedValue(new Error("Unauthorized"));
    expect((await describeImage(post({ imageUrl: DATA_URL }))).status).toBe(401);
  });

  describe("openai", () => {
    it("returns the model's description", async () => {
      const response = await describeImage(post({ imageUrl: HTTP_URL }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ description: "A white ceramic mug" });
    });

    it("sends the image at high detail alongside the instruction", async () => {
      await describeImage(post({ imageUrl: HTTP_URL }));

      const content = openAICreate.mock.calls[0][0].messages[1].content;
      expect(content[0]).toEqual({
        type: "image_url",
        image_url: { url: HTTP_URL, detail: "high" },
      });
      expect(content[1].type).toBe("text");
    });

    it("defaults the model to gpt-4o", async () => {
      await describeImage(post({ imageUrl: HTTP_URL }));
      expect(openAICreate.mock.calls[0][0].model).toBe("gpt-4o");
    });

    it("uses the configured model when there is one", async () => {
      settings.mockResolvedValue({
        llmProvider: "openai",
        llmApiKey: "k",
        llmModel: "gpt-4o-mini",
      } as never);

      await describeImage(post({ imageUrl: HTTP_URL }));
      expect(openAICreate.mock.calls[0][0].model).toBe("gpt-4o-mini");
    });

    it("returns an empty description when the model says nothing", async () => {
      openAICreate.mockResolvedValue({ choices: [{ message: { content: null } }] });
      await expect((await describeImage(post({ imageUrl: HTTP_URL }))).json()).resolves.toEqual({
        description: "",
      });
    });
  });

  describe("gemini", () => {
    beforeEach(() => {
      withProvider("gemini");
    });

    it("passes the decoded base64 image inline", async () => {
      await describeImage(post({ imageUrl: DATA_URL }));

      const parts = generateContent.mock.calls[0][0];
      expect(parts[1]).toEqual({
        inlineData: { mimeType: "image/png", data: "AAAABBBB" },
      });
    });

    it("rejects a plain URL, which the API cannot take", async () => {
      const response = await describeImage(post({ imageUrl: HTTP_URL }));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Gemini vision requires a base64 image (data URL)",
      });
    });
  });

  describe("anthropic", () => {
    beforeEach(() => {
      withProvider("anthropic");
    });

    it("sends a base64 image block for a data URL", async () => {
      await describeImage(post({ imageUrl: DATA_URL }));

      const block = anthropicCreate.mock.calls[0][0].messages[0].content[0];
      expect(block).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAABBBB" },
      });
    });

    it("sends a url image block for a plain URL", async () => {
      await describeImage(post({ imageUrl: HTTP_URL }));

      const block = anthropicCreate.mock.calls[0][0].messages[0].content[0];
      expect(block).toEqual({ type: "image", source: { type: "url", url: HTTP_URL } });
    });

    it("returns the first text block", async () => {
      anthropicCreate.mockResolvedValue({
        content: [{ type: "thinking" }, { type: "text", text: "A mug" }],
      });

      await expect((await describeImage(post({ imageUrl: DATA_URL }))).json()).resolves.toEqual({
        description: "A mug",
      });
    });

    it("returns an empty description when there is no text block", async () => {
      anthropicCreate.mockResolvedValue({ content: [{ type: "tool_use" }] });
      await expect((await describeImage(post({ imageUrl: DATA_URL }))).json()).resolves.toEqual({
        description: "",
      });
    });
  });

  describe("a provider without vision", () => {
    it("falls back to asking the user to type a description", async () => {
      withProvider("ollama");

      const response = await describeImage(post({ imageUrl: DATA_URL }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        description: "Please describe your product in text.",
      });
      expect(llmGenerate).toHaveBeenCalled();
    });
  });

  it("answers 500 with the provider's message when the call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    openAICreate.mockRejectedValue(new Error("rate limited"));

    const response = await describeImage(post({ imageUrl: HTTP_URL }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "rate limited" });
  });
});
