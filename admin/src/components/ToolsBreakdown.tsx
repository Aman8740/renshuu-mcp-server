import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { ToolBreakdownEntry } from "../lib/api";

export function ToolsBreakdown({ tools }: { tools: ToolBreakdownEntry[] }) {
  const top = tools.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Most-used tools</CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
            No tool calls recorded yet.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(180, top.length * 32)}>
              <BarChart data={top} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#26262b" horizontal={false} />
                <XAxis type="number" stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="tool"
                  stroke="#a1a1aa"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={160}
                />
                <Tooltip
                  contentStyle={{ background: "#111113", border: "1px solid #26262b", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "#18181b" }}
                />
                <Bar dataKey="callsAllTime" name="Calls (all-time)" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Tool</th>
                  <th className="pb-2 text-right font-normal">Today</th>
                  <th className="pb-2 text-right font-normal">All-time</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.tool} className="border-t border-border">
                    <td className="py-1.5 font-mono text-xs">{t.tool}</td>
                    <td className="py-1.5 text-right">{t.callsToday}</td>
                    <td className="py-1.5 text-right">{t.callsAllTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
