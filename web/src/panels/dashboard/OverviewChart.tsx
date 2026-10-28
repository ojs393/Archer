import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsBucket, AnalyticsPoint } from "@/lib/types";

/** Distinct series colors — readable on light canvas, not greyscale. */
export const CHART_COLORS = {
  sent: "hsl(221.2 83.2% 53.3%)",
  failed: "hsl(0 72% 51%)",
  suppressed: "hsl(32 95% 44%)",
  retry: "hsl(262 52% 55%)",
  uncertain: "hsl(25 95% 53%)",
} as const;

function tickLabel(iso: string, bucket: AnalyticsBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (bucket === "hour") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

function hasActivity(points: AnalyticsPoint[]): boolean {
  return points.some((p) => p.sent + p.failed + p.suppressed + p.retry + p.uncertain > 0);
}

export default function OverviewChart({
  points,
  bucket,
}: {
  points: AnalyticsPoint[];
  bucket: AnalyticsBucket;
}) {
  if (!points.length || !hasActivity(points)) {
    return (
      <div
        className="flex h-56 w-full flex-col items-center justify-center gap-1 rounded-md bg-gradient-to-b from-zinc-50 to-white text-center sm:h-64 md:h-72"
        data-testid="overview-chart"
        data-empty="true"
      >
        <p className="text-sm font-medium text-foreground">No activity in this range</p>
        <p className="text-xs text-muted-foreground">Counts appear here once sends start updating.</p>
      </div>
    );
  }

  return (
    <div
      className="h-56 w-full min-w-0 sm:h-64 md:h-72"
      data-testid="overview-chart"
      role="img"
      aria-label="Send activity over time"
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={points} margin={{ top: 12, right: 12, left: 4, bottom: 28 }}>
          <defs>
            <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.sent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS.sent} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.failed} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART_COLORS.failed} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fillSuppressed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.suppressed} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.suppressed} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          {/* Time on the horizontal (X) axis — standard for activity over time. */}
          <XAxis
            dataKey="t"
            tickFormatter={(t: string) => tickLabel(t, bucket)}
            tick={{ fill: "#52525b", fontSize: 11 }}
            tickLine={{ stroke: "#d4d4d8" }}
            axisLine={{ stroke: "#a1a1aa" }}
            minTickGap={24}
            height={36}
            interval="preserveStartEnd"
          >
            <Label value="Time" position="insideBottom" offset={-16} style={{ fill: "#71717a", fontSize: 12, fontWeight: 500 }} />
          </XAxis>
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#52525b", fontSize: 11 }}
            tickLine={{ stroke: "#d4d4d8" }}
            axisLine={{ stroke: "#a1a1aa" }}
            width={48}
          >
            <Label
              value="Count"
              angle={-90}
              position="insideLeft"
              offset={10}
              style={{ fill: "#71717a", fontSize: 12, fontWeight: 500, textAnchor: "middle" }}
            />
          </YAxis>
          <Tooltip
            labelFormatter={(t) => `Time · ${tickLabel(String(t), bucket)}`}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e4e4e7",
              boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
              fontSize: 12,
            }}
          />
          <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="sent" name="Sent" stroke={CHART_COLORS.sent} fill="url(#fillSent)" strokeWidth={2} />
          <Area type="monotone" dataKey="failed" name="Failed" stroke={CHART_COLORS.failed} fill="url(#fillFailed)" strokeWidth={1.75} />
          <Area
            type="monotone"
            dataKey="suppressed"
            name="Suppressed"
            stroke={CHART_COLORS.suppressed}
            fill="url(#fillSuppressed)"
            strokeWidth={1.75}
          />
          <Area
            type="monotone"
            dataKey="retry"
            name="Retry"
            stroke={CHART_COLORS.retry}
            fill={CHART_COLORS.retry}
            fillOpacity={0.12}
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="uncertain"
            name="Uncertain"
            stroke={CHART_COLORS.uncertain}
            fill={CHART_COLORS.uncertain}
            fillOpacity={0.12}
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
