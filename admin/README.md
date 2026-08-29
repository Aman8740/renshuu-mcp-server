# renshuu-mcp-server admin dashboard

Source for the `/admin` analytics dashboard. React + TypeScript + Tailwind v4
+ shadcn-pattern components (hand-built, not CLI-generated — the shadcn
registry wasn't reachable from the environment this was built in, so these
are the same Tailwind/CVA conventions written directly) + Recharts.

**This is not deployed as-is.** It's built once into a single self-contained
HTML file (`vite-plugin-singlefile` — all JS/CSS inlined, zero separate
asset requests) and embedded as a TypeScript string constant in
`../src/admin/dashboardHtml.ts`, which the Express server serves directly
at `GET /admin`. See that file's own header comment for why (short version:
`vercel.json` rewrites every path to one function, so normal static-file
serving from `public/` can't be relied on for this).

## Making changes

```bash
cd admin
npm install
npm run dev        # local dev server, hot reload — but /admin/api/* calls
                    # will 404 unless you also run the backend and proxy,
                    # since this dev server has no API of its own
```

To ship a change:

```bash
npm run build       # tsc -b && vite build && node embed.mjs
```

That last step (`embed.mjs`) reads `dist/index.html` and rewrites
`../src/admin/dashboardHtml.ts` automatically. Then rebuild/redeploy the
main server as usual — nothing else to wire up.

## Structure

```
src/
├── App.tsx                 # auth gate + tab layout + data fetching
├── lib/
│   ├── api.ts               # typed fetch wrapper for /admin/api/*
│   └── utils.ts              # cn() — shadcn's class-merge helper
└── components/
    ├── LoginScreen.tsx
    ├── KpiCards.tsx
    ├── RequestsChart.tsx      # 24h/30d requests+errors, recharts area chart
    ├── ToolsBreakdown.tsx     # per-tool call counts, bar chart + table
    ├── AuthMethodsChart.tsx   # oauth vs header vs env-fallback, donut
    ├── ActivityFeed.tsx       # live-polling recent-requests table
    ├── ErrorsFeed.tsx
    ├── UsersTable.tsx         # pseudonymous (hashed) per-user activity
    ├── OAuthFunnel.tsx        # register → login → token funnel
    └── ui/                    # card, button, badge, tabs — shadcn-pattern primitives
```

## Design notes

- Dark theme, neutral palette, Tailwind v4's `@theme` tokens in `index.css`
  — no separate `tailwind.config.js` needed (v4's Vite plugin picks up
  the CSS-based theme directly).
- Every data-fetching component treats "no data" as a normal, expected
  state (fresh deploy, analytics not configured yet) — never a loading
  spinner forever or a crash.
- No user's actual renshuu API key ever reaches this dashboard, even
  server-side — see `../src/analytics/hash.ts`. Every "user" shown here is
  a one-way hash.
