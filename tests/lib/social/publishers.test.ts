import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishToTwitter } from "@/lib/social/twitter";
import { publishToLinkedIn } from "@/lib/social/linkedin";
import { publishToFacebook, publishToInstagram } from "@/lib/social/meta";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ json: async () => ({ id: "post_1" }) });
});

const call = (n = 0) => ({
  url: fetchMock.mock.calls[n][0] as string,
  init: fetchMock.mock.calls[n][1] as { method: string; headers: Record<string, string>; body: string },
});
const bodyOf = (n = 0) => JSON.parse(call(n).init.body);

describe("publishToTwitter", () => {
  const options = {
    apiKey: "consumer-key",
    apiSecret: "consumer-secret",
    accessToken: "access-token",
    accessTokenSecret: "access-secret",
    text: "Hello world",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts the text to the v2 tweets endpoint", async () => {
    await publishToTwitter(options);

    expect(call().url).toBe("https://api.twitter.com/2/tweets");
    expect(call().init.method).toBe("POST");
    expect(bodyOf()).toEqual({ text: "Hello world" });
  });

  it("attaches media when a media id is supplied", async () => {
    await publishToTwitter({ ...options, mediaId: "media_9" });
    expect(bodyOf()).toEqual({ text: "Hello world", media: { media_ids: ["media_9"] } });
  });

  it("signs the request with OAuth 1.0a", async () => {
    await publishToTwitter(options);

    const auth = call().init.headers.Authorization;
    expect(auth).toMatch(/^OAuth /);
    expect(auth).toContain('oauth_consumer_key="consumer-key"');
    expect(auth).toContain('oauth_token="access-token"');
    expect(auth).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(auth).toContain('oauth_version="1.0"');
    expect(auth).toContain("oauth_signature=");
  });

  it("stamps the request with the current unix time", async () => {
    await publishToTwitter(options);
    expect(call().init.headers.Authorization).toContain(
      `oauth_timestamp="${Math.floor(Date.parse("2026-08-25T12:00:00Z") / 1000)}"`
    );
  });

  it("uses a different nonce on every call", async () => {
    await publishToTwitter(options);
    await publishToTwitter(options);

    const nonce = (n: number) =>
      /oauth_nonce="([^"]+)"/.exec(call(n).init.headers.Authorization)![1];

    expect(nonce(0)).not.toBe(nonce(1));
  });

  it("never puts the secrets in the header in the clear", async () => {
    await publishToTwitter(options);

    const auth = call().init.headers.Authorization;
    expect(auth).not.toContain("consumer-secret");
    expect(auth).not.toContain("access-secret");
  });

  it("returns the parsed API response", async () => {
    await expect(publishToTwitter(options)).resolves.toEqual({ id: "post_1" });
  });
});

describe("publishToLinkedIn", () => {
  const options = { accessToken: "li-token", personUrn: "urn:li:person:1", text: "Hello" };

  it("posts a text share to the ugcPosts endpoint", async () => {
    await publishToLinkedIn(options);

    expect(call().url).toBe("https://api.linkedin.com/v2/ugcPosts");
    expect(call().init.headers.Authorization).toBe("Bearer li-token");
    expect(call().init.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
  });

  it("marks a text-only post as having no media", async () => {
    await publishToLinkedIn(options);

    const content = bodyOf().specificContent["com.linkedin.ugc.ShareContent"];
    expect(content.shareMediaCategory).toBe("NONE");
    expect(content).not.toHaveProperty("media");
    expect(content.shareCommentary).toEqual({ text: "Hello" });
  });

  it("attaches an image when one is supplied", async () => {
    await publishToLinkedIn({ ...options, imageUrl: "https://cdn/i.png" });

    const content = bodyOf().specificContent["com.linkedin.ugc.ShareContent"];
    expect(content.shareMediaCategory).toBe("IMAGE");
    expect(content.media).toEqual([{ status: "READY", originalUrl: "https://cdn/i.png" }]);
  });

  it("posts publicly as the given author", async () => {
    await publishToLinkedIn(options);

    expect(bodyOf().author).toBe("urn:li:person:1");
    expect(bodyOf().lifecycleState).toBe("PUBLISHED");
    expect(bodyOf().visibility["com.linkedin.ugc.MemberNetworkVisibility"]).toBe("PUBLIC");
  });
});

describe("publishToFacebook", () => {
  const options = {
    accessToken: "fb-token",
    pageId: "page_1",
    message: "Hello",
    platform: "facebook" as const,
  };

  it("posts text to the page feed", async () => {
    await publishToFacebook(options);

    expect(call().url).toBe("https://graph.facebook.com/v19.0/page_1/feed");
    expect(bodyOf()).toEqual({ message: "Hello", access_token: "fb-token" });
  });

  it("posts to the photos endpoint when there is an image", async () => {
    await publishToFacebook({ ...options, imageUrl: "https://cdn/i.png" });

    expect(call().url).toBe("https://graph.facebook.com/v19.0/page_1/photos");
    expect(bodyOf()).toEqual({
      url: "https://cdn/i.png",
      message: "Hello",
      access_token: "fb-token",
    });
  });

  it("returns the parsed API response", async () => {
    await expect(publishToFacebook(options)).resolves.toEqual({ id: "post_1" });
  });
});

describe("publishToInstagram", () => {
  const options = {
    accessToken: "ig-token",
    pageId: "ig_1",
    message: "Hello",
    imageUrl: "https://cdn/i.png",
    platform: "instagram" as const,
  };

  it("refuses to post without an image", async () => {
    await expect(publishToInstagram({ ...options, imageUrl: undefined })).rejects.toThrow(
      "Instagram requires an image"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a media container then publishes it", async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ id: "container_1" }) })
      .mockResolvedValueOnce({ json: async () => ({ id: "published_1" }) });

    const result = await publishToInstagram(options);

    expect(call(0).url).toBe("https://graph.facebook.com/v19.0/ig_1/media");
    expect(bodyOf(0)).toEqual({
      image_url: "https://cdn/i.png",
      caption: "Hello",
      access_token: "ig-token",
    });

    expect(call(1).url).toBe("https://graph.facebook.com/v19.0/ig_1/media_publish");
    expect(bodyOf(1)).toEqual({ creation_id: "container_1", access_token: "ig-token" });

    expect(result).toEqual({ id: "published_1" });
  });
});
