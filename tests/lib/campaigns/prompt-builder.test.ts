import { describe, expect, it } from "vitest";
import {
  buildBrandContext,
  buildCampaignPrompt,
  buildImagePrompt,
} from "@/lib/campaigns/prompt-builder";
import { makeBrandDNA } from "../../fixtures/brand-dna";

describe("buildBrandContext", () => {
  it("includes the brand identity", () => {
    const context = buildBrandContext(makeBrandDNA());
    expect(context).toContain("Name: Acme Coffee");
    expect(context).toContain("Tagline: Roasted with intent");
    expect(context).toContain("Industry: Food & Beverage / Coffee Roaster");
  });

  it("renders colours as name and hex", () => {
    expect(buildBrandContext(makeBrandDNA())).toContain(
      "Brand Colors: Brown (#6F4E37), Orange (#C0A080)"
    );
  });

  it("renders fonts as family and usage", () => {
    expect(buildBrandContext(makeBrandDNA())).toContain(
      "Typography: Playfair Display (heading), Inter (body)"
    );
  });

  it("includes the tone profile with its numeric dimensions", () => {
    const context = buildBrandContext(makeBrandDNA());
    expect(context).toContain("Tone: friendly (primary), inspirational (secondary)");
    expect(context).toContain("Formality: 30/100");
    expect(context).toContain("Energy: 70/100");
    expect(context).toContain("Warmth: 85/100");
  });

  it("includes the audience and keywords", () => {
    const context = buildBrandContext(makeBrandDNA());
    expect(context).toContain("Home brewers (primary), Cafe owners (secondary)");
    expect(context).toContain("Age Range: 25-45");
    expect(context).toContain("Interests: specialty coffee, sustainability");
    expect(context).toContain("Pain Points: stale beans, inconsistent extraction");
    expect(context).toContain("Keywords: single origin, small batch");
  });

  it("survives a brand with no colours, fonts or keywords", () => {
    const context = buildBrandContext(
      makeBrandDNA({ colors: [], fonts: [], keywords: [] })
    );
    expect(context).toContain("Brand Colors: ");
    expect(context).toContain("Typography: ");
  });
});

describe("buildCampaignPrompt", () => {
  const dna = makeBrandDNA();

  it("embeds the brand context", () => {
    const prompt = buildCampaignPrompt(dna, "Launch cold brew", ["instagram"]);
    expect(prompt).toContain(buildBrandContext(dna));
  });

  it("includes the goal and the requested platforms", () => {
    const prompt = buildCampaignPrompt(dna, "Launch cold brew", ["instagram", "linkedin"]);
    expect(prompt).toContain("CAMPAIGN GOAL: Launch cold brew");
    expect(prompt).toContain("TARGET PLATFORMS: instagram, linkedin");
  });

  it("defaults to English", () => {
    expect(buildCampaignPrompt(dna, "goal", ["instagram"])).toContain("LANGUAGE: English");
  });

  it("honours a requested language, including in the rules", () => {
    const prompt = buildCampaignPrompt(dna, "goal", ["instagram"], "Arabic");
    expect(prompt).toContain("LANGUAGE: Arabic");
    expect(prompt).toContain("All content must be in Arabic");
  });

  it("tells the model to use the brand's actual colours in image prompts", () => {
    const prompt = buildCampaignPrompt(dna, "goal", ["instagram"]);
    expect(prompt).toContain("#6F4E37, #C0A080");
  });

  it("carries the brand tone into the rules", () => {
    expect(buildCampaignPrompt(dna, "goal", ["instagram"])).toContain(
      "All content must match the brand's friendly tone"
    );
  });

  it("asks for the JSON shape the generator parses", () => {
    const prompt = buildCampaignPrompt(dna, "goal", ["instagram"]);
    expect(prompt).toContain('"concepts"');
    expect(prompt).toContain('"imagePrompt"');
    expect(prompt).toContain("Generate exactly 5 campaign concepts");
  });
});

describe("buildImagePrompt", () => {
  it("uses the brand's first two colours", () => {
    const prompt = buildImagePrompt(makeBrandDNA(), "Harvest", "instagram");
    expect(prompt).toContain("Primary color: #6F4E37");
    expect(prompt).toContain("Secondary color: #C0A080");
  });

  it("falls back to default colours when the brand has none", () => {
    const prompt = buildImagePrompt(makeBrandDNA({ colors: [] }), "Harvest", "instagram");
    expect(prompt).toContain("Primary color: #6366F1");
    expect(prompt).toContain("Secondary color: #818CF8");
  });

  it("falls back for the secondary colour only when there is just one", () => {
    const dna = makeBrandDNA({
      colors: [{ hex: "#6F4E37", name: "Brown", usage: "primary", rgb: [111, 78, 55] }],
    });
    const prompt = buildImagePrompt(dna, "Harvest", "instagram");
    expect(prompt).toContain("Primary color: #6F4E37");
    expect(prompt).toContain("Secondary color: #818CF8");
  });

  it("picks the right dimensions per platform", () => {
    const dna = makeBrandDNA();
    expect(buildImagePrompt(dna, "t", "instagram")).toContain("1080x1080 square");
    expect(buildImagePrompt(dna, "t", "facebook")).toContain("1200x630 landscape");
    expect(buildImagePrompt(dna, "t", "linkedin")).toContain("1200x627 landscape");
    expect(buildImagePrompt(dna, "t", "twitter")).toContain("1600x900 landscape");
  });

  it("falls back to a square for an unknown platform", () => {
    expect(buildImagePrompt(makeBrandDNA(), "t", "pinterest")).toContain("1080x1080 square");
  });

  it("includes the concept theme, industry and tone", () => {
    const prompt = buildImagePrompt(makeBrandDNA(), "Harvest", "instagram");
    expect(prompt).toContain("Theme: Harvest");
    expect(prompt).toContain("Industry: Food & Beverage");
    expect(prompt).toContain("friendly, inspirational marketing image for Acme Coffee");
  });

  it("tells the model to keep text out of the image", () => {
    expect(buildImagePrompt(makeBrandDNA(), "t", "instagram")).toContain(
      "Do NOT include any text in the image"
    );
  });
});
