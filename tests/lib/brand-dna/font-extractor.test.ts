import { describe, expect, it } from "vitest";
import { extractFonts } from "@/lib/brand-dna/font-extractor";

const font = (family: string, tag: string, weight = "400") => ({ family, tag, weight });

describe("extractFonts", () => {
  it("returns nothing for no input", () => {
    expect(extractFonts([])).toEqual([]);
  });

  it("takes the first non-generic family from a font stack", () => {
    const fonts = extractFonts([font('"Playfair Display", Georgia, serif', "h1")]);
    expect(fonts).toEqual([{ family: "Playfair Display", usage: "heading", weight: "400" }]);
  });

  it("strips quotes from family names", () => {
    expect(extractFonts([font("'Inter', sans-serif", "p")])[0].family).toBe("Inter");
  });

  it("ignores stacks made up entirely of generic or system fonts", () => {
    const fonts = extractFonts([
      font("Arial, Helvetica, sans-serif", "p"),
      font("-apple-system, BlinkMacSystemFont, 'Segoe UI'", "h1"),
      font("monospace", "code"),
    ]);
    expect(fonts).toEqual([]);
  });

  it("classifies a family used in a heading as a heading font", () => {
    for (const tag of ["h1", "h2", "h3"]) {
      expect(extractFonts([font("Playfair Display", tag)])[0].usage).toBe("heading");
    }
  });

  it("classifies a family used on interactive elements as an accent font", () => {
    for (const tag of ["button", "a", "nav"]) {
      expect(extractFonts([font("Inter", tag)])[0].usage).toBe("accent");
    }
  });

  it("falls back to body for anything else", () => {
    expect(extractFonts([font("Inter", "p")])[0].usage).toBe("body");
  });

  it("prefers heading over accent when a family is used for both", () => {
    const fonts = extractFonts([font("Inter", "button"), font("Inter", "h2")]);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].usage).toBe("heading");
  });

  it("is case-insensitive about tags", () => {
    expect(extractFonts([font("Playfair Display", "H1")])[0].usage).toBe("heading");
  });

  it("keeps the weight from the first occurrence of a family", () => {
    const fonts = extractFonts([font("Inter", "p", "400"), font("Inter", "h1", "700")]);
    expect(fonts[0].weight).toBe("400");
  });

  it("returns at most three fonts, in the order they were first seen", () => {
    const fonts = extractFonts([
      font("One", "p"),
      font("Two", "p"),
      font("Three", "p"),
      font("Four", "h1"),
    ]);

    expect(fonts.map((f) => f.family)).toEqual(["One", "Two", "Three"]);
  });
});
