import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const COLORS: Record<string, string> = {
  oauth: "#6366f1",
  header: "#22c55e",
  env_fallback: "#f59e0b",
  none: "#71717a",
};

const LABELS: Record<string, string> = {
  oauth: "OAuth (per-user)",
  header: "x-renshuu-api-key header",
  env_fallback: "Shared env fallback",
  none: "No auth resolved",
};

export function AuthMethodsChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, name: LABELS[key] ?? key, value }));
  const total = entries.reduce((sum, e) => sum + e.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Auth method mix</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">No data yet.</div>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={180}>
              <PieChart>
                <Pie data={entries} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {entries.map((e) => (
                    <Cell key={e.key} fill={COLORS[e.key] ?? "#71717a"} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#111113", border: "1px solid #26262b", borderRadius: 8, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-1 flex-col gap-2 text-sm">
              {entries.map((e) => (
                <div key={e.key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[e.key] ?? "#71717a" }} />
                    {e.name}
                  </span>
                  <span className="font-medium">{((e.value / total) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
