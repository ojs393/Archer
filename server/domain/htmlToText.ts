import { convert, type HtmlToTextOptions } from "html-to-text";

const OPTIONS: HtmlToTextOptions = {
  wordwrap: 100,
  selectors: [
    { selector: "img", format: "skip" },
    { selector: "a", options: { linkBrackets: ["(", ")"], hideLinkHrefIfSameAsText: true } },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
  ],
};

export function htmlToText(html: string): string {
  return convert(html, OPTIONS);
}
