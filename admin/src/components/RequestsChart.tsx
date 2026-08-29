import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { api, type TimeseriesPoint } from "../lib/api";

function formatBucket(bucket: string, range: "24h" | "30d"): string {
  if (range === "24h") {
    const hour = bucket.slice(11, 13);
    return `${hour}:00`;
  }
  const [, m, d] = bucket.split("-");
  return `${m}/${d}`;
}

export function RequestsChart() {
  const [range, setRange] = useState<"24h" | "30d">("24h");
  const [data, setData] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .timeseries(range)
      .then((points) => {
        if (!cancelled) setData(points);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const chartData = data.map((p) => ({ ...p, label: formatBucket(p.bucket, range) }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold text-foreground">Requests over time</CardTitle>
        <Tabs value={range} onValueChange={(v) => setRange(v as "24h" | "30d")}>
          <TabsList>
            <TabsTrigger value="24h">24h</TabsTrigger>
            <TabsTrigger value="30d">30d</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : data.every((d) => d.total === 0) ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No requests recorded yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ left: -20, right: 10, top: 10 }}>
              <defs>
                <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#26262b" vertical={false} />
              <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#111113", border: "1px solid #26262b", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#fafafa" }}
              />
              <Area type="monotone" dataKey="total" name="Requests" stroke="#6366f1" fill="url(#totalGradient)" strokeWidth={2} />
              <Area type="monotone" dataKey="errors" name="Errors" stroke="#ef4444" fill="url(#errorGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
