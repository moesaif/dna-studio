import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeyGenProvider } from "@/lib/video/providers/heygen";
import { DIDProvider } from "@/lib/video/providers/did";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const fail = (status: number, body: unknown = {}) => ({
  ok: false,
  status,
  json: async () => body,
});
const call = (n = 0) => ({
  url: fetchMock.mock.calls[n][0] as string,
  init: (fetchMock.mock.calls[n][1] ?? {}) as { headers: Record<string, string>; body?: string },
});

describe("HeyGenProvider", () => {
  const options = { script: "Try our mug", avatarId: "av_1" };

  it("reads the key from HEYGEN_API_KEY when not given one", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "hg-env");
    fetchMock.mockResolvedValue(ok({ data: { avatars: [] } }));

    await new HeyGenProvider().listAvatars();

    expect(call().init.headers["X-Api-Key"]).toBe("hg-env");
  });

  describe("listAvatars", () => {
    it("maps HeyGen avatars onto the shared shape", async () => {
      fetchMock.mockResolvedValue(
        ok({
          data: {
            avatars: [
              { avatar_id: "a1", avatar_name: "Mia", preview_image_url: "https://t/1.png", gender: "female" },
            ],
          },
        })
      );

      await expect(new HeyGenProvider("k").listAvatars()).resolves.toEqual([
        { id: "a1", name: "Mia", thumbnailUrl: "https://t/1.png", gender: "female", style: "professional" },
      ]);
    });

    it("defaults an unknown gender to female", async () => {
      fetchMock.mockResolvedValue(
        ok({ data: { avatars: [{ avatar_id: "a1", avatar_name: "X", preview_image_url: "", gender: "" }] } })
      );

      expect((await new HeyGenProvider("k").listAvatars())[0].gender).toBe("female");
    });

    it("caps the list at 24", async () => {
      const avatars = Array.from({ length: 40 }, (_, i) => ({
        avatar_id: `a${i}`, avatar_name: "n", preview_image_url: "", gender: "male",
      }));
      fetchMock.mockResolvedValue(ok({ data: { avatars } }));

      expect(await new HeyGenProvider("k").listAvatars()).toHaveLength(24);
    });

    it("returns an empty list when HeyGen sends no avatars", async () => {
      fetchMock.mockResolvedValue(ok({}));
      await expect(new HeyGenProvider("k").listAvatars()).resolves.toEqual([]);
    });

    it("throws on an API error", async () => {
      fetchMock.mockResolvedValue(fail(401));
      await expect(new HeyGenProvider("k").listAvatars()).rejects.toThrow("HeyGen avatars error: 401");
    });
  });

  describe("generate", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(ok({ data: { video_id: "v_1" } }));
    });

    it("queues a video and returns its id", async () => {
      await expect(new HeyGenProvider("k").generate(options)).resolves.toEqual({
        videoId: "v_1",
        status: "queued",
      });
      expect(call().url).toBe("https://api.heygen.com/v2/video/generate");
    });

    it.each([
      [undefined, { width: 1080, height: 1920 }],
      ["9:16", { width: 1080, height: 1920 }],
      ["16:9", { width: 1920, height: 1080 }],
      ["1:1", { width: 1080, height: 1080 }],
    ])("maps aspect ratio %s to %o", async (aspectRatio, dimension) => {
      await new HeyGenProvider("k").generate({
        ...options,
        ...(aspectRatio ? { aspectRatio: aspectRatio as "16:9" } : {}),
      });

      expect(JSON.parse(call().init.body!).dimension).toEqual(dimension);
    });

    it("sends the script and avatar", async () => {
      await new HeyGenProvider("k").generate(options);

      const input = JSON.parse(call().init.body!).video_inputs[0];
      expect(input.character.avatar_id).toBe("av_1");
      expect(input.voice.input_text).toBe("Try our mug");
    });

    it("uses a white background by default and the product image when given", async () => {
      await new HeyGenProvider("k").generate(options);
      expect(JSON.parse(call(0).init.body!).video_inputs[0].background).toEqual({
        type: "color",
        value: "#FFFFFF",
      });

      await new HeyGenProvider("k").generate({ ...options, productImageUrl: "https://cdn/p.png" });
      expect(JSON.parse(call(1).init.body!).video_inputs[0].background).toEqual({
        type: "image",
        url: "https://cdn/p.png",
      });
    });

    it("surfaces the API's error message", async () => {
      fetchMock.mockResolvedValue(fail(400, { message: "avatar not found" }));
      await expect(new HeyGenProvider("k").generate(options)).rejects.toThrow(
        "HeyGen generation error: avatar not found"
      );
    });

    it("falls back to the status code when the error body is unreadable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      });
      await expect(new HeyGenProvider("k").generate(options)).rejects.toThrow(
        "HeyGen generation error: 500"
      );
    });

    it("throws when no video id comes back", async () => {
      fetchMock.mockResolvedValue(ok({ data: {} }));
      await expect(new HeyGenProvider("k").generate(options)).rejects.toThrow(
        "HeyGen did not return a video ID"
      );
    });
  });

  describe("getStatus", () => {
    it.each([
      ["completed", "completed"],
      ["failed", "failed"],
      ["processing", "processing"],
      ["pending", "queued"],
    ])("maps HeyGen status %s to %s", async (heygen, expected) => {
      fetchMock.mockResolvedValue(ok({ data: { status: heygen } }));
      const result = await new HeyGenProvider("k").getStatus("v_1");
      expect(result.status).toBe(expected);
    });

    it("returns the video url, thumbnail and rounded duration", async () => {
      fetchMock.mockResolvedValue(
        ok({
          data: {
            status: "completed",
            video_url: "https://cdn/v.mp4",
            thumbnail_url: "https://cdn/t.png",
            duration: 12.6,
          },
        })
      );

      await expect(new HeyGenProvider("k").getStatus("v_1")).resolves.toEqual({
        videoId: "v_1",
        status: "completed",
        videoUrl: "https://cdn/v.mp4",
        thumbnailUrl: "https://cdn/t.png",
        duration: 13,
        error: undefined,
      });
    });

    it("reports the failure reason, defaulting when none is given", async () => {
      fetchMock.mockResolvedValue(ok({ data: { status: "failed" } }));
      expect((await new HeyGenProvider("k").getStatus("v_1")).error).toBe("Generation failed");

      fetchMock.mockResolvedValue(ok({ data: { status: "failed", error: "bad script" } }));
      expect((await new HeyGenProvider("k").getStatus("v_1")).error).toBe("bad script");
    });

    it("throws on an API error", async () => {
      fetchMock.mockResolvedValue(fail(404));
      await expect(new HeyGenProvider("k").getStatus("v_1")).rejects.toThrow("HeyGen status error: 404");
    });
  });
});

describe("DIDProvider", () => {
  const options = { script: "Try our mug", avatarId: "presenter_1" };

  it("authenticates with a Basic header from DID_API_KEY", async () => {
    vi.stubEnv("DID_API_KEY", "did-env");
    fetchMock.mockResolvedValue(ok({ presenters: [] }));

    await new DIDProvider().listAvatars();

    expect(call().init.headers.Authorization).toBe("Basic did-env");
  });

  it("maps presenters onto the shared shape and caps at 24", async () => {
    fetchMock.mockResolvedValue(
      ok({
        presenters: Array.from({ length: 30 }, (_, i) => ({
          presenter_id: `p${i}`, name: "", thumbnail_url: "https://t.png", gender: "male",
        })),
      })
    );

    const avatars = await new DIDProvider("k").listAvatars();

    expect(avatars).toHaveLength(24);
    expect(avatars[0]).toEqual({
      id: "p0", name: "Presenter", thumbnailUrl: "https://t.png", gender: "male", style: "professional",
    });
  });

  it("throws when presenters cannot be listed", async () => {
    fetchMock.mockResolvedValue(fail(403));
    await expect(new DIDProvider("k").listAvatars()).rejects.toThrow("D-ID presenters error: 403");
  });

  describe("generate", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(ok({ id: "clip_1" }));
    });

    it("creates a clip and returns its id", async () => {
      await expect(new DIDProvider("k").generate(options)).resolves.toEqual({
        videoId: "clip_1",
        status: "queued",
      });
      expect(call().url).toBe("https://api.d-id.com/clips");
    });

    it("sends the presenter and script", async () => {
      await new DIDProvider("k").generate(options);

      const body = JSON.parse(call().init.body!);
      expect(body.presenter_id).toBe("presenter_1");
      expect(body.script.input).toBe("Try our mug");
      expect(body.config.result_format).toBe("mp4");
    });

    it("adds a background only when a product image is supplied", async () => {
      await new DIDProvider("k").generate(options);
      expect(JSON.parse(call(0).init.body!)).not.toHaveProperty("background");

      await new DIDProvider("k").generate({ ...options, productImageUrl: "https://cdn/p.png" });
      expect(JSON.parse(call(1).init.body!).background).toEqual({ source_url: "https://cdn/p.png" });
    });

    it("surfaces the API's description on error", async () => {
      fetchMock.mockResolvedValue(fail(400, { description: "invalid presenter" }));
      await expect(new DIDProvider("k").generate(options)).rejects.toThrow(
        "D-ID generation error: invalid presenter"
      );
    });
  });

  describe("getStatus", () => {
    it.each([
      ["done", "completed"],
      ["error", "failed"],
      ["started", "processing"],
      ["created", "processing"],
      ["queued", "queued"],
    ])("maps D-ID status %s to %s", async (did, expected) => {
      fetchMock.mockResolvedValue(ok({ status: did }));
      expect((await new DIDProvider("k").getStatus("clip_1")).status).toBe(expected);
    });

    it("returns the result url and rounded duration", async () => {
      fetchMock.mockResolvedValue(
        ok({ status: "done", result_url: "https://cdn/v.mp4", thumbnail_url: "https://cdn/t.png", duration: 9.2 })
      );

      await expect(new DIDProvider("k").getStatus("clip_1")).resolves.toEqual({
        videoId: "clip_1",
        status: "completed",
        videoUrl: "https://cdn/v.mp4",
        thumbnailUrl: "https://cdn/t.png",
        duration: 9,
        error: undefined,
      });
    });

    it("reports a generic failure message", async () => {
      fetchMock.mockResolvedValue(ok({ status: "error" }));
      expect((await new DIDProvider("k").getStatus("clip_1")).error).toBe("Video generation failed");
    });

    it("throws on an API error", async () => {
      fetchMock.mockResolvedValue(fail(500));
      await expect(new DIDProvider("k").getStatus("clip_1")).rejects.toThrow("D-ID status error: 500");
    });
  });
});
