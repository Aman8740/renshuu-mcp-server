import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { api, type McpEvent } from "../lib/api";

const AUTH_LABEL: Record<string, string> = {
  oauth: "OAuth",
  header: "Header",
  env_fallback: "Env fallback",
  none: "None",
};

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<McpEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await api.activity(100).catch(() => []);
      if (!cancelled) {
        setEvents(data);
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">
          Live activity <span className="text-xs font-normal text-muted-foreground">(refreshes every 8s)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No activity recorded yet.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">When</th>
                  <th className="pb-2 font-normal">Method</th>
                  <th className="pb-2 font-normal">Tool</th>
                  <th className="pb-2 font-normal">Auth</th>
                  <th className="pb-2 text-right font-normal">Duration</th>
                  <th className="pb-2 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-t border-border">
                    <td className="py-1.5 text-xs text-muted-foreground">{timeAgo(e.ts)}</td>
                    <td className="py-1.5 font-mono text-xs">{e.method}</td>
                    <td className="py-1.5 font-mono text-xs">{e.toolName ?? "—"}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{AUTH_LABEL[e.authMethod] ?? e.authMethod}</td>
                    <td className="py-1.5 text-right text-xs">{e.durationMs}ms</td>
                    <td className="py-1.5 text-right">
                      <Badge variant={e.success ? "success" : "destructive"}>{e.success ? "ok" : "error"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
