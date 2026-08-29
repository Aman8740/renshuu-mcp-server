import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { UserRow } from "../lib/api";

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function UsersTable({ users }: { users: UserRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">
          Users <span className="text-xs font-normal text-muted-foreground">(pseudonymous — a hash of each API key, never the key itself)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No users yet.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">User</th>
                  <th className="pb-2 font-normal">First seen</th>
                  <th className="pb-2 font-normal">Last seen</th>
                  <th className="pb-2 text-right font-normal">Total calls</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userHash} className="border-t border-border">
                    <td className="py-1.5 font-mono text-xs">{u.userHash}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{formatDate(u.firstSeen)}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{formatDate(u.lastSeen)}</td>
                    <td className="py-1.5 text-right">{u.totalCalls}</td>
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
