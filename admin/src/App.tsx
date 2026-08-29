import { useEffect, useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { KpiCards } from "./components/KpiCards";
import { RequestsChart } from "./components/RequestsChart";
import { ToolsBreakdown } from "./components/ToolsBreakdown";
import { AuthMethodsChart } from "./components/AuthMethodsChart";
import { ActivityFeed } from "./components/ActivityFeed";
import { ErrorsFeed } from "./components/ErrorsFeed";
import { UsersTable } from "./components/UsersTable";
import { OAuthFunnel } from "./components/OAuthFunnel";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  api,
  type Overview,
  type ToolBreakdownEntry,
  type McpEvent,
  type UserRow,
  type OAuthEventType,
} from "./lib/api";

type AuthState = "checking" | "signed-out" | "signed-in";
type Tab = "overview" | "activity" | "users" | "oauth";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [username, setUsername] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setUsername(res.username);
        setAuthState("signed-in");
      })
      .catch(() => setAuthState("signed-out"));
  }, []);

  async function handleLogout() {
    await api.logout().catch(() => {});
    setAuthState("signed-out");
    setUsername(null);
  }

  if (authState === "checking") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (authState === "signed-out") {
    return <LoginScreen onSuccess={() => window.location.reload()} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-base font-semibold">renshuu-mcp-server</h1>
            <p className="text-xs text-muted-foreground">Analytics dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{username}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity &amp; errors</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="oauth">OAuth</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "overview" && <OverviewTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "users" && <UsersTab />}
        {tab === "oauth" && <OAuthTab />}
      </main>
    </div>
  );
}

function OverviewTab() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tools, setTools] = useState<ToolBreakdownEntry[]>([]);
  const [authMethods, setAuthMethods] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [o, t, a] = await Promise.all([
        api.overview().catch(() => null),
        api.tools().catch(() => []),
        api.authMethods().catch(() => ({})),
      ]);
      if (cancelled) return;
      if (o) setOverview(o);
      setTools(t);
      setAuthMethods(a);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!overview) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {!overview.configured && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          Analytics storage isn't configured yet — set <code className="font-mono">UPSTASH_REDIS_REST_URL</code> and{" "}
          <code className="font-mono">UPSTASH_REDIS_REST_TOKEN</code> to start collecting data. The server itself
          works fine without it; this dashboard just has nothing to show yet.
        </div>
      )}
      <KpiCards overview={overview} />
      <RequestsChart />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ToolsBreakdown tools={tools} />
        <AuthMethodsChart data={authMethods} />
      </div>
    </div>
  );
}

function ActivityTab() {
  const [errors, setErrors] = useState<McpEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const e = await api.errors(50).catch(() => []);
      if (!cancelled) setErrors(e);
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <ActivityFeed />
      <ErrorsFeed errors={errors} />
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    api
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  return <UsersTable users={users} />;
}

function OAuthTab() {
  const [funnel, setFunnel] = useState<Record<OAuthEventType, number> | null>(null);

  useEffect(() => {
    api
      .oauthFunnel()
      .then(setFunnel)
      .catch(() => setFunnel(null));
  }, []);

  if (!funnel) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return <OAuthFunnel data={funnel} />;
}
