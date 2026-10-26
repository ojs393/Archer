import { describe, it, expect } from "vitest";
import { htmlToText } from "../../server/domain/htmlToText.ts";

describe("htmlToText", () => {
  it("drops images", () => {
    const text = htmlToText('<p>Hello <img src="https://x.com/a.png" alt="logo"> there</p>');
    expect(text).toBe("Hello there");
  });

  it("keeps link URLs in parentheses", () => {
    expect(htmlToText('<p>Read <a href="https://x.com/post">the post</a></p>')).toBe("Read the post (https://x.com/post)");
  });

  it("hides the URL when it equals the link text", () => {
    expect(htmlToText('<a href="https://x.com">https://x.com</a>')).toBe("https://x.com");
  });

  it("separates paragraphs and keeps line breaks", () => {
    expect(htmlToText("<p>One<br>Two</p><p>Three</p>")).toBe("One\nTwo\n\nThree");
  });

  it("does not uppercase headings", () => {
    expect(htmlToText("<h1>Hi Tom</h1>")).toBe("Hi Tom");
  });
});
