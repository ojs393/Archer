import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OverviewChart, { CHART_COLORS } from "./OverviewChart";

describe("OverviewChart", () => {
  it("exports distinct non-grey series colors", () => {
    expect(CHART_COLORS.sent).toMatch(/221/);
    expect(CHART_COLORS.failed).toMatch(/72%/);
    expect(CHART_COLORS.suppressed).not.toBe(CHART_COLORS.failed);
    expect(CHART_COLORS.retry).not.toBe(CHART_COLORS.uncertain);
  });

  it("shows an empty state when every bucket is zero", () => {
    render(
      <OverviewChart
        bucket="hour"
        points={[{ t: "2026-10-26T10:00:00.000Z", sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0 }]}
      />,
    );
    expect(screen.getByTestId("overview-chart")).toHaveAttribute("data-empty", "true");
    expect(screen.getByText(/No activity in this range/)).toBeInTheDocument();
  });

  it("exposes a time-labeled chart when there is activity", () => {
    render(
      <OverviewChart
        bucket="hour"
        points={[
          { t: "2026-10-26T10:00:00.000Z", sent: 2, failed: 0, suppressed: 0, retry: 0, uncertain: 0 },
          { t: "2026-10-26T11:00:00.000Z", sent: 3, failed: 1, suppressed: 0, retry: 0, uncertain: 0 },
        ]}
      />,
    );
    const chart = screen.getByTestId("overview-chart");
    expect(chart).not.toHaveAttribute("data-empty");
    expect(chart).toHaveAttribute("aria-label", "Send activity over time");
  });
});
