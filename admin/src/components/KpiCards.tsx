import { Card, CardContent, CardHeader, CardTitle, CardValue } from "./ui/card";
import type { Overview } from "../lib/api";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function KpiCards({ overview }: { overview: Overview }) {
  const cards = [
    { title: "Requests today", value: overview.requestsToday.toLocaleString() },
    { title: "Requests all-time", value: overview.totalRequestsAllTime.toLocaleString() },
    { title: "Unique users today", value: overview.uniqueUsersToday.toLocaleString() },
    { title: "Unique users all-time", value: overview.uniqueUsersAllTime.toLocaleString() },
    {
      title: "Error rate today",
      value: pct(overview.errorRateToday),
      warn: overview.errorRateToday > 0.05,
    },
    {
      title: "Error rate all-time",
      value: pct(overview.errorRateAllTime),
      warn: overview.errorRateAllTime > 0.05,
    },
    { title: "Avg response time", value: `${overview.avgDurationMsAllTime}ms` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader>
            <CardTitle>{c.title}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <CardValue className={c.warn ? "text-destructive" : undefined}>{c.value}</CardValue>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
