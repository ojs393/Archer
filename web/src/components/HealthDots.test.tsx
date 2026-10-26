import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HealthDots } from "./HealthDots";

describe("HealthDots", () => {
  it("gives every dot a 24x32 hit target at all breakpoints, with a gap", () => {
    render(
      <TooltipProvider>
        <HealthDots health={null} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("group", { name: "Health" }).className.split(" ")).toContain("gap-1");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "SMTP: Not checked",
      "DNS: Not checked",
      "Network: Not checked",
      "Worker: Not checked",
    ]);
    for (const button of buttons) {
      const classes = button.className.split(" ");
      expect(classes).toEqual(expect.arrayContaining(["h-8", "w-6"]));
      expect(classes.filter((c) => /^(\w+:)+[wh]-/.test(c))).toEqual([]);
    }
  });
});
