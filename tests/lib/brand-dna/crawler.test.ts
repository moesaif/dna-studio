import { beforeEach, describe, expect, it, vi } from "vitest";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));

vi.mock("playwright", () => ({ chromium: { launch } }));
vi.mock("@/lib/llm/client", () => ({ generateJSON: vi.fn() }));

import { generateJSON } from "@/lib/llm/client";
import { crawlBrandDNA } from "@/lib/brand-dna/crawler";

const llm = vi.mocked(generateJSON);

const META = {
  name: "Acme Coffee",
  description: "Roasted with intent",
  logoUrl: "https://acme.coffee/logo.svg",
  favicon: "https://acme.coffee/favicon.ico",
  ogImage: null,
};

const ANALYSIS = {
  tone: {
    primary: "friendly",
    secondary: "inspirational",
    description: "Warm",
    formality: 30,
    energy: 70,
    warmth: 85,
  },
  audience: {
    primary: "Home brewers",
    secondary: "Cafe owners",
    ageRange: "25-45",
    interests: ["coffee"],
    painPoints: ["stale beans"],
  },
  industry: "Food & Beverage",
  category: "Coffee Roaster",
  keywords: ["single origin"],
};

const goto = vi.fn();
const close = vi.fn();
const evaluate = vi.fn();

/** page.evaluate is called in a fixed order by crawlBrandDNA. */
function stubPage({
  meta = META,
  cssColors = ["color: #6F4E37", "color: #C0A080"],
  fonts = [{ family: "Playfair Display", tag: "h1", weight: "700" }],
  logos = [{ url: "https://acme.coffee/logo.svg", alt: "Acme" }],
  text = "Acme Coffee roasts single origin beans.",
} = {}) {
  evaluate
    .mockResolvedValueOnce(meta)
    .mockResolvedValueOnce(cssColors)
    .mockResolvedValueOnce(fonts)
    .mockResolvedValueOnce(logos)
    .mockResolvedValueOnce(text);
}

beforeEach(() => {
  goto.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
  launch.mockResolvedValue({
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({ goto, evaluate, waitForTimeout: vi.fn() }),
    }),
    close,
  });
  llm.mockResolvedValue(ANALYSIS as never);
});

describe("crawlBrandDNA", () => {
  it("returns a complete brand profile", async () => {
    stubPage();

    const dna = await crawlBrandDNA("https://acme.coffee");

    expect(dna).toMatchObject({
      name: "Acme Coffee",
      tagline: "Roasted with intent",
      url: "https://acme.coffee",
      logoUrl: "https://acme.coffee/logo.svg",
      industry: "Food & Beverage",
      category: "Coffee Roaster",
    });
    expect(dna.colors.map((c) => c.hex)).toEqual(["#6F4E37", "#C0A080"]);
    expect(dna.fonts[0].family).toBe("Playfair Display");
  });

  it("launches a headless browser and visits the URL", async () => {
    stubPage();

    await crawlBrandDNA("https://acme.coffee");

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
    expect(goto).toHaveBeenCalledWith(
      "https://acme.coffee",
      expect.objectContaining({ waitUntil: "networkidle" })
    );
  });

  it("honours PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for the container build", async () => {
    vi.stubEnv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "/usr/bin/chromium-browser");
    stubPage();

    await crawlBrandDNA("https://acme.coffee");

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: "/usr/bin/chromium-browser" })
    );
  });

  it("reports progress for each step", async () => {
    stubPage();
    const steps: string[] = [];

    await crawlBrandDNA("https://acme.coffee", (p) => {
      if (p.status === "running") steps.push(p.step);
    });

    expect(steps).toEqual([
      "Launching browser",
      "Crawling site",
      "Extracting metadata",
      "Extracting colors",
      "Extracting fonts",
      "Extracting logos",
      "Extracting content",
      "Analyzing tone",
    ]);
  });

  it("always closes the browser, even when the crawl fails", async () => {
    goto.mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED"));

    await expect(crawlBrandDNA("https://nope.invalid")).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
    expect(close).toHaveBeenCalled();
  });

  it("closes the browser after a successful crawl", async () => {
    stubPage();
    await crawlBrandDNA("https://acme.coffee");
    expect(close).toHaveBeenCalled();
  });

  it("falls back to the hostname when the page has no title", async () => {
    stubPage({ meta: { ...META, name: "" } });

    const dna = await crawlBrandDNA("https://acme.coffee");

    expect(dna.name).toBe("acme.coffee");
  });

  it("uses an empty tagline when there is no description", async () => {
    stubPage({ meta: { ...META, description: "" } });

    expect((await crawlBrandDNA("https://acme.coffee")).tagline).toBe("");
  });

  it("still returns a profile when the LLM analysis fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubPage();
    llm.mockRejectedValue(new Error("model unavailable"));

    const dna = await crawlBrandDNA("https://acme.coffee");

    expect(dna.name).toBe("Acme Coffee");
    expect(dna.tone.primary).toBeTruthy();
    expect(dna.industry).toBeTruthy();
  });

  it("reports the LLM failure through the progress callback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubPage();
    llm.mockRejectedValue(new Error("model unavailable"));

    const events: { step: string; status: string; detail?: string }[] = [];
    await crawlBrandDNA("https://acme.coffee", (p) => events.push(p));

    const toneStep = events.find((e) => e.step === "Analyzing tone" && e.status === "error");
    expect(toneStep?.detail).toContain("model unavailable");
  });

  it("caps the raw text it keeps", async () => {
    stubPage({ text: "x".repeat(5000) });

    expect((await crawlBrandDNA("https://acme.coffee")).rawText).toHaveLength(2000);
  });

  it("works on a site with no colours or fonts to find", async () => {
    stubPage({ cssColors: [], fonts: [], logos: [] });

    const dna = await crawlBrandDNA("https://acme.coffee");

    expect(dna.colors).toEqual([]);
    expect(dna.fonts).toEqual([]);
    expect(dna.logos).toEqual([]);
  });
});
