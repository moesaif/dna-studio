import type { BrandDNA } from "@/lib/brand-dna/types";

/**
 * A complete BrandDNA, so tests can override just the field under test:
 *
 *   makeBrandDNA({ colors: [] })
 */
export function makeBrandDNA(overrides: Partial<BrandDNA> = {}): BrandDNA {
  return {
    name: "Acme Coffee",
    tagline: "Roasted with intent",
    url: "https://acme.coffee",
    logoUrl: "https://acme.coffee/logo.svg",
    favicon: "https://acme.coffee/favicon.ico",
    ogImage: null,
    logos: [],
    colors: [
      { hex: "#6F4E37", name: "Brown", usage: "primary", rgb: [111, 78, 55] },
      { hex: "#C0A080", name: "Orange", usage: "secondary", rgb: [192, 160, 128] },
    ],
    fonts: [
      { family: "Playfair Display", usage: "heading", weight: "700" },
      { family: "Inter", usage: "body", weight: "400" },
    ],
    tone: {
      primary: "friendly",
      secondary: "inspirational",
      description: "Warm and unpretentious",
      formality: 30,
      energy: 70,
      warmth: 85,
    },
    audience: {
      primary: "Home brewers",
      secondary: "Cafe owners",
      ageRange: "25-45",
      interests: ["specialty coffee", "sustainability"],
      painPoints: ["stale beans", "inconsistent extraction"],
    },
    industry: "Food & Beverage",
    category: "Coffee Roaster",
    keywords: ["single origin", "small batch"],
    rawText: "Acme Coffee roasts single origin beans in small batches.",
    ...overrides,
  };
}
