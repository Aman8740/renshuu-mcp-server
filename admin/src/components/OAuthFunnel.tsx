import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { OAuthEventType } from "../lib/api";

const STEPS: { key: OAuthEventType; label: string }[] = [
  { key: "client_registered", label: "Clients registered" },
  { key: "authorize_shown", label: "Login page shown" },
  { key: "login_success", label: "Login succeeded" },
  { key: "login_failed", label: "Login failed" },
  { key: "token_issued", label: "Tokens issued" },
  { key: "token_refreshed", label: "Tokens refreshed" },
  { key: "token_exchange_failed", label: "Token exchange failed" },
];

export function OAuthFunnel({ data }: { data: Record<OAuthEventType, number> }) {
  const max = Math.max(1, ...STEPS.map((s) => data[s.key] ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">OAuth connection funnel</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {STEPS.map((s) => {
          const value = data[s.key] ?? 0;
          const isFailure = s.key.includes("fail");
          return (
            <div key={s.key}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full ${isFailure ? "bg-destructive" : "bg-accent"}`}
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
