import { afterEach, describe, expect, it } from "vitest";
import { getFocusModality, installFocusModality, setFocusModality } from "./focusModality";

describe("focus modality", () => {
  afterEach(() => {
    delete document.documentElement.dataset.modality;
  });

  it("defaults to pointer and switches on Tab / pointerdown", () => {
    const stop = installFocusModality();
    expect(getFocusModality()).toBe("pointer");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(getFocusModality()).toBe("keyboard");

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(getFocusModality()).toBe("pointer");

    stop();
  });

  it("ignores modified keydowns and non-nav keys", () => {
    const stop = installFocusModality();
    setFocusModality("pointer");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", metaKey: true, bubbles: true }));
    expect(getFocusModality()).toBe("pointer");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(getFocusModality()).toBe("pointer");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(getFocusModality()).toBe("keyboard");
    stop();
  });
});
