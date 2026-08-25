import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { imagesGenerate, openAICtor, getGenerativeModel, generateContent, geminiCtor } = vi.hoisted(
  () => ({
    imagesGenerate: vi.fn(),
    openAICtor: vi.fn(),
    getGenerativeModel: vi.fn(),
    generateContent: vi.fn(),
    geminiCtor: vi.fn(),
  })
);

vi.mock("openai", () => ({
  default: function (options: { apiKey?: string }) {
    openAICtor(options);
    return { images: { generate: imagesGenerate } };
  },
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: function (apiKey: string) {
    geminiCtor(apiKey);
    return { getGenerativeModel };
  },
}));

import { OpenAIImageProvider } from "@/lib/image/providers/openai";
import { StabilityProvider } from "@/lib/image/providers/stability";
import { ReplicateProvider } from "@/lib/image/providers/replicate";
import { GeminiImageProvider } from "@/lib/image/providers/gemini";

describe("OpenAIImageProvider", () => {
  beforeEach(() => {
    imagesGenerate.mockResolvedValue({ data: [{ url: "https://img/1.png" }] });
  });

  it("passes the key to the SDK and falls back to the environment", () => {
    new OpenAIImageProvider("sk-explicit");
    expect(openAICtor).toHaveBeenCalledWith({ apiKey: "sk-explicit" });

    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    new OpenAIImageProvider();
    expect(openAICtor).toHaveBeenLastCalledWith({ apiKey: "sk-env" });
  });

  it("asks DALL-E 3 for a single standard-quality image", async () => {
    await new OpenAIImageProvider("sk").generate("a mug");

    expect(imagesGenerate).toHaveBeenCalledWith({
      model: "dall-e-3",
      prompt: "a mug",
      n: 1,
      size: "1024x1024",
      quality: "standard",
    });
  });

  it("passes the requested size through", async () => {
    await new OpenAIImageProvider("sk").generate("a mug", { size: "1792x1024" });
    expect(imagesGenerate).toHaveBeenCalledWith(expect.objectContaining({ size: "1792x1024" }));
  });

  it("returns the generated URL", async () => {
    await expect(new OpenAIImageProvider("sk").generate("a mug")).resolves.toEqual({
      url: "https://img/1.png",
    });
  });

  it("throws when the API returns no image", async () => {
    imagesGenerate.mockResolvedValue({ data: [] });
    await expect(new OpenAIImageProvider("sk").generate("a mug")).rejects.toThrow(
      "No image URL returned from DALL-E"
    );
  });
});

describe("StabilityProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ image: "BASE64DATA" }) });
  });

  it("refuses to construct without a key", () => {
    expect(() => new StabilityProvider()).toThrow("STABILITY_API_KEY is not set");
  });

  it("accepts a key from the environment", () => {
    vi.stubEnv("STABILITY_API_KEY", "sk-env");
    expect(() => new StabilityProvider()).not.toThrow();
  });

  it("sends the prompt as multipart form data with a bearer token", async () => {
    await new StabilityProvider("sk").generate("a mug");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stability.ai/v2beta/stable-image/generate/core");
    expect(init.headers.Authorization).toBe("Bearer sk");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("prompt")).toBe("a mug");
  });

  it.each([
    ["1024x1024", "1:1"],
    ["1024x1792", "9:16"],
    ["1792x1024", "16:9"],
  ])("maps size %s to aspect ratio %s", async (size, ratio) => {
    await new StabilityProvider("sk").generate("a mug", { size: size as "1024x1024" });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("aspect_ratio")).toBe(ratio);
  });

  it("returns the image as a base64 data URL", async () => {
    await expect(new StabilityProvider("sk").generate("a mug")).resolves.toEqual({
      url: "data:image/jpeg;base64,BASE64DATA",
    });
  });

  it("surfaces an API error with its status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, text: async () => "payment required" });
    await expect(new StabilityProvider("sk").generate("a mug")).rejects.toThrow(
      "Stability AI error 402: payment required"
    );
  });

  it("throws when the response carries no image", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(new StabilityProvider("sk").generate("a mug")).rejects.toThrow(
      "No image returned from Stability AI"
    );
  });
});

describe("ReplicateProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const submitReturns = (prediction: object) =>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => prediction });
  const pollReturns = (prediction: object) =>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => prediction });

  it("refuses to construct without a token", () => {
    expect(() => new ReplicateProvider()).toThrow("REPLICATE_API_TOKEN is not set");
  });

  it("submits a prediction then polls until it succeeds", async () => {
    submitReturns({ id: "pred_1", status: "starting" });
    pollReturns({ id: "pred_1", status: "processing" });
    pollReturns({ id: "pred_1", status: "succeeded", output: ["https://img/out.png"] });

    const promise = new ReplicateProvider("r8").generate("a mug");
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ url: "https://img/out.png" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.replicate.com/v1/predictions/pred_1");
  });

  it("sends the prompt and dimensions for the requested size", async () => {
    submitReturns({ id: "p", status: "starting" });
    pollReturns({ id: "p", status: "succeeded", output: ["https://img/o.png"] });

    const promise = new ReplicateProvider("r8").generate("a mug", { size: "1024x1792" });
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      input: { prompt: "a mug", width: 1024, height: 1792 },
    });
  });

  it("authenticates with a Token header", async () => {
    submitReturns({ id: "p", status: "starting" });
    pollReturns({ id: "p", status: "succeeded", output: ["https://img/o.png"] });

    const promise = new ReplicateProvider("r8").generate("a mug");
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Token r8");
  });

  it("surfaces a submission error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });
    await expect(new ReplicateProvider("r8").generate("a mug")).rejects.toThrow(
      "Replicate error 401: unauthorized"
    );
  });

  it.each(["failed", "canceled"])("throws when the prediction is %s", async (status) => {
    submitReturns({ id: "p", status: "starting" });
    pollReturns({ id: "p", status, error: "nsfw" });

    const promise = new ReplicateProvider("r8").generate("a mug");
    const assertion = expect(promise).rejects.toThrow(`Replicate prediction ${status}: nsfw`);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("throws when a succeeded prediction has no output", async () => {
    submitReturns({ id: "p", status: "starting" });
    pollReturns({ id: "p", status: "succeeded", output: [] });

    const promise = new ReplicateProvider("r8").generate("a mug");
    const assertion = expect(promise).rejects.toThrow("No output URL from Replicate");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("gives up after 60 seconds", async () => {
    submitReturns({ id: "p", status: "starting" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "p", status: "processing" }) });

    const promise = new ReplicateProvider("r8").generate("a mug");
    const assertion = expect(promise).rejects.toThrow("Replicate prediction timed out after 60s");
    await vi.advanceTimersByTimeAsync(65_000);
    await assertion;
  });
});

describe("GeminiImageProvider", () => {
  const imagePart = (mimeType: string, data: string) => ({
    response: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] },
  });

  beforeEach(() => {
    generateContent.mockResolvedValue(imagePart("image/png", "BASE64"));
    getGenerativeModel.mockReturnValue({ generateContent });
  });

  it("passes the key, falling back to GOOGLE_API_KEY", () => {
    new GeminiImageProvider("goog");
    expect(geminiCtor).toHaveBeenCalledWith("goog");

    vi.stubEnv("GOOGLE_API_KEY", "goog-env");
    new GeminiImageProvider();
    expect(geminiCtor).toHaveBeenLastCalledWith("goog-env");
  });

  it("uses GEMINI_IMAGE_MODEL when set", async () => {
    vi.stubEnv("GEMINI_IMAGE_MODEL", "gemini-image-2");
    await new GeminiImageProvider("k").generate("a mug");
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-image-2" })
    );
  });

  it("asks for both text and image modalities", async () => {
    await new GeminiImageProvider("k").generate("a mug");
    expect(getGenerativeModel.mock.calls[0][0].generationConfig.responseModalities).toEqual([
      "TEXT",
      "IMAGE",
    ]);
  });

  it.each([
    [undefined, "1:1 square"],
    ["1024x1792", "9:16 portrait"],
    ["1792x1024", "16:9 landscape"],
  ])("hints aspect ratio %s as %s", async (size, hint) => {
    await new GeminiImageProvider("k").generate("a mug", size ? { size: size as "1024x1792" } : undefined);
    expect(generateContent).toHaveBeenCalledWith(`Generate an image: a mug. Aspect ratio: ${hint}`);
  });

  it("returns the inline image as a data URL", async () => {
    generateContent.mockResolvedValue(imagePart("image/webp", "WEBPDATA"));
    await expect(new GeminiImageProvider("k").generate("a mug")).resolves.toEqual({
      url: "data:image/webp;base64,WEBPDATA",
    });
  });

  it("skips text parts and finds the image", async () => {
    generateContent.mockResolvedValue({
      response: {
        candidates: [
          { content: { parts: [{ text: "Here you go" }, { inlineData: { mimeType: "image/png", data: "B64" } }] } },
        ],
      },
    });

    await expect(new GeminiImageProvider("k").generate("a mug")).resolves.toEqual({
      url: "data:image/png;base64,B64",
    });
  });

  it("throws when the model returns only text", async () => {
    generateContent.mockResolvedValue({
      response: { candidates: [{ content: { parts: [{ text: "I cannot" }] } }] },
    });

    await expect(new GeminiImageProvider("k").generate("a mug")).rejects.toThrow(
      "Gemini did not return an image"
    );
  });

  it("throws when there are no candidates at all", async () => {
    generateContent.mockResolvedValue({ response: {} });
    await expect(new GeminiImageProvider("k").generate("a mug")).rejects.toThrow(
      "Gemini did not return an image"
    );
  });
});
