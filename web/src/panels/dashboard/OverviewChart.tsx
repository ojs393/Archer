import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsBucket, AnalyticsPoint } from "@/lib/types";

const SENT = "hsl(221.2 83.2% 53.3%)";
const FAILED = "#52525b";
const SUPPRESSED = "#a1a1aa";

function tickLabel(iso: string, bucket: AnalyticsBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return bucket === "hour"
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric" });
}

export default function OverviewChart({
  points,
  bucket,
}: {
  points: AnalyticsPoint[];
  bucket: AnalyticsBucket;
}) {
  return (
    <div className="h-64 w-full" data-testid="overview-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(t: string) => tickLabel(t, bucket)}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#e4e4e7" }}
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            labelFormatter={(t) => tickLabel(String(t), bucket)}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e4e4e7",
              fontSize: 12,
            }}
          />
          <Legend />
          <Area type="monotone" dataKey="sent" name="Sent" stroke={SENT} fill={SENT} fillOpacity={0.15} strokeWidth={2} />
          <Area type="monotone" dataKey="failed" name="Failed" stroke={FAILED} fill={FAILED} fillOpacity={0.1} strokeWidth={1.5} />
          <Area
            type="monotone"
            dataKey="suppressed"
            name="Suppressed"
            stroke={SUPPRESSED}
            fill={SUPPRESSED}
            fillOpacity={0.1}
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
