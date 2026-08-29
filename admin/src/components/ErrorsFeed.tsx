import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { McpEvent } from "../lib/api";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ErrorsFeed({ errors }: { errors: McpEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Recent errors</CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No errors recorded. 🎉
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">When</th>
                  <th className="pb-2 font-normal">Method</th>
                  <th className="pb-2 font-normal">Tool</th>
                  <th className="pb-2 font-normal">Auth</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-t border-border">
                    <td className="py-1.5 text-xs text-muted-foreground">{formatDate(e.ts)}</td>
                    <td className="py-1.5 font-mono text-xs text-destructive">{e.method}</td>
                    <td className="py-1.5 font-mono text-xs">{e.toolName ?? "—"}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{e.authMethod}</td>
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
