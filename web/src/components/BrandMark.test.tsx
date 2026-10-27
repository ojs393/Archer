import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark, MARK_PATHS } from "./BrandMark";

const markSvg = fs.readFileSync(path.resolve(__dirname, "../../public/brand/mark.svg"), "utf8");

describe("BrandMark", () => {
  it("inlines exactly the paths and colours of mark.svg", () => {
    const fromFile = [...markSvg.matchAll(/<path d="([^"]+)" fill="([^"]+)"\/>/g)].map(([, d, fill]) => ({ d, fill }));
    expect(fromFile).toHaveLength(14);
    expect(markSvg.match(/<path /g)).toHaveLength(fromFile.length);
    expect(MARK_PATHS).toEqual(fromFile);
  });

  it("is decorative without a title and labelled with one", () => {
    const { container, rerender } = render(<BrandMark size={28} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "28");
    rerender(<BrandMark size={40} title="Archer" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-label", "Archer");
    expect(container.querySelectorAll("path")).toHaveLength(14);
  });
});
