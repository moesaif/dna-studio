import { describe, expect, it } from "vitest";
import { extractColorsFromCSS } from "@/lib/brand-dna/color-extractor";

describe("extractColorsFromCSS", () => {
  it("returns nothing when the CSS contains no colours", () => {
    expect(extractColorsFromCSS([])).toEqual([]);
    expect(extractColorsFromCSS(["font-size: 14px", "margin: 0 auto"])).toEqual([]);
  });

  it("extracts hex colours and normalises them to uppercase", () => {
    const [color] = extractColorsFromCSS(["color: #ff5733"]);
    expect(color.hex).toBe("#FF5733");
  });

  it("expands three-digit shorthand hex", () => {
    const [color] = extractColorsFromCSS(["color: #f00"]);
    expect(color.hex).toBe("#FF0000");
    expect(color.rgb).toEqual([255, 0, 0]);
  });

  it("drops the alpha channel from eight-digit hex", () => {
    const [color] = extractColorsFromCSS(["color: #ff573380"]);
    expect(color.hex).toBe("#FF5733");
  });

  it("parses rgb() and rgba() notation", () => {
    const [color] = extractColorsFromCSS(["color: rgb(255, 87, 51)"]);
    expect(color.hex).toBe("#FF5733");

    const [alpha] = extractColorsFromCSS(["color: rgba(255, 87, 51, 0.5)"]);
    expect(alpha.hex).toBe("#FF5733");
  });

  it("treats the same colour written two ways as one colour", () => {
    const colors = extractColorsFromCSS(["color: #ff5733", "border-color: rgb(255, 87, 51)"]);
    expect(colors).toHaveLength(1);
  });

  it("orders colours by how often they appear", () => {
    const colors = extractColorsFromCSS([
      "a { color: #1188ff }",
      "b { color: #1188ff }",
      "c { color: #1188ff }",
      "d { color: #ff8811 }",
      "e { color: #ff8811 }",
      "f { color: #22bb22 }",
    ]);

    expect(colors.map((c) => c.hex)).toEqual(["#1188FF", "#FF8811", "#22BB22"]);
  });

  it("filters out near-white, near-black and washed-out colours", () => {
    const colors = extractColorsFromCSS([
      "color: #FFFFFF",
      "color: #000000",
      "color: #FEFEFE",
      "color: #010101",
      "color: #EFEFEF",
      "color: #1188FF",
    ]);

    expect(colors.map((c) => c.hex)).toEqual(["#1188FF"]);
  });

  it("keeps at most six colours", () => {
    const css = ["#1188FF", "#FF8811", "#22BB22", "#BB22BB", "#22BBBB", "#BBBB22", "#884422"].map(
      (hex) => `color: ${hex}`
    );

    expect(extractColorsFromCSS(css)).toHaveLength(6);
  });

  it("assigns usage by position, with the last colour treated as text", () => {
    const css = ["#1188FF", "#FF8811", "#22BB22", "#BB22BB", "#22BBBB", "#BBBB22"].map(
      (hex, i) => Array(10 - i).fill(`color: ${hex}`).join(" ")
    );

    expect(extractColorsFromCSS(css).map((c) => c.usage)).toEqual([
      "primary",
      "secondary",
      "accent",
      "background",
      "background",
      "text",
    ]);
  });

  it("names colours by hue", () => {
    const nameOf = (hex: string) => extractColorsFromCSS([`color: ${hex}`])[0].name;

    expect(nameOf("#FF0000")).toBe("Red");
    expect(nameOf("#FF8800")).toBe("Orange");
    expect(nameOf("#22BB22")).toBe("Green");
    expect(nameOf("#1188FF")).toBe("Blue");
    expect(nameOf("#8822BB")).toBe("Purple");
    expect(nameOf("#888888")).toBe("Gray");
  });

  it("returns the rgb triple alongside the hex", () => {
    const [color] = extractColorsFromCSS(["color: #1188FF"]);
    expect(color.rgb).toEqual([17, 136, 255]);
  });
});
