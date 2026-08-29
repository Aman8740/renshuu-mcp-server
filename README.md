# renshuu-mcp-server

MCP server for renshuu.org (JLPT vocab/kanji/grammar tracking) — **built to
serve multiple people's accounts from one deployment**, plus a standalone
client library you can reuse outside of MCP.

## This is verified against the real API

The endpoints, param names, auth scheme, and response shapes here were
confirmed by fetching the real OpenAPI spec live from
`https://api.renshuu.org/api-docs` with a working API key. The raw spec is
included at `openapi/renshuu.openapi.json` — that file is the source of
truth this project was built from, and the monthly GitHub Action (below)
re-checks it against the live API automatically.

## Multi-tenant by design

This is the core architectural point, worth understanding before deploying:

**A single deployed server can correctly serve many different renshuu
accounts at once.** No user's request can see or affect another's data.

- **stdio mode** (local CLI / Claude Desktop): single-user by nature of the
  transport — reads `RENSHUU_API_KEY` from your `.env` once, same as any
  local tool.
- **HTTP mode** (deployed server / Vercel): reads the key from an
  **`X-Renshuu-Api-Key`** request header on **every single request**,
  independently. `RENSHUU_API_KEY` in the environment is only used as a
  fallback if a request arrives with no header at all — handy for your own
  testing of a deployment, not meant for production multi-user traffic.
- A fresh `RenshuuClient` (and fresh MCP server instance) is built **per
  request** in HTTP mode. Nothing about one caller's key or in-flight
  request is shared with another's, even under concurrent load — this is
  covered by `src/__tests__/multiTenant.test.ts`, which fires two real
  concurrent HTTP requests with two different keys and confirms neither
  affects the other.
- The one exception, by design and clearly documented: a **best-effort,
  in-memory daily rate-limit counter**, keyed by a hash of each API key
  (`src/renshuu/budgetRegistry.ts`). This lets repeated requests from the
  *same* user share a running count (so the courtesy guard actually does
  something), while different users' counts stay fully isolated from each
  other. It is NOT authoritative — it resets on process restart and does
  not share state across multiple server instances (e.g. separate Vercel
  function invocations). Renshuu's own server-side `429` is the real
  enforcement; this just avoids some wasted round-trips in the common case.

**A real bug this design fixes:** earlier versions of this project had
`buildServer()` call `process.exit(1)` if no API key was found. In HTTP
mode, that meant *one* request with a missing or bad key would crash the
entire server — taking down every other connected user with it. This is
fixed: `buildServer()` now throws an error instead of exiting, and the HTTP
layer catches it and returns a clean `401` to just that one caller while
continuing to serve everyone else. `src/__tests__/multiTenant.test.ts`
specifically tests this: it sends a request with no key, confirms it gets a
`401` (not a hang or crash), and then confirms the server is still alive by
successfully calling `/health` right after.

## Project layout

```
src/
├── index.ts              # buildServer(), createHttpApp(), stdio + HTTP entry points
├── constants.ts           # Base URL, confirmed auth scheme, rate limit
├── types.ts               # TypeScript interfaces matching the real schemas
├── renshuu/
│   ├── client.ts          # Core API client — ZERO MCP dependency, reusable anywhere
│   ├── budgetRegistry.ts  # Shared per-API-key rate-limit tracking
│   └── errors.ts           # Typed errors (auth, rate limit, generic API error)
├── oauth/                 # OAuth 2.1 + PKCE + Dynamic Client Registration
│   ├── crypto.ts           # Stateless JWE tokens — no database, see file header
│   ├── pkce.ts
│   ├── baseUrl.ts
│   └── routes.ts           # /.well-known/*, /register, /authorize, /token
├── analytics/              # Event logging + queries for the admin dashboard
│   ├── redis.ts             # Upstash client — gracefully no-ops if unconfigured
│   ├── hash.ts               # One-way pseudonymous user IDs (never store real keys)
│   ├── log.ts                 # Write side — see file header for the Redis key layout
│   ├── query.ts                # Read side, used by admin/routes.ts
│   └── middleware.ts            # Best-effort response tapping for success/failure detection
├── admin/                  # /admin dashboard — auth + API + embedded frontend
│   ├── auth.ts              # Timing-safe login check, signed session cookie
│   ├── routes.ts             # Login/logout/me + all dashboard data endpoints
│   └── dashboardHtml.ts       # GENERATED — see admin/README.md, don't hand-edit
├── services/
│   └── formatting.ts      # Shared tool-response formatting/truncation
├── tools/                 # One file per resource domain, MCP tool registration only
│   ├── profile.ts          # Profile + study stats + JLPT-level progress
│   ├── schedules.ts
│   ├── lists.ts
│   ├── dictionary.ts
│   ├── presence.ts         # add/remove term to list/schedule
│   ├── jlpt.ts               # composite: JLPT-level readiness summary
│   └── mastery.ts            # composite: per-term personal mastery lookup
└── __tests__/
    ├── client.test.ts          # unit tests, mocked fetch, no real network
    ├── client.budget.test.ts   # rate-limit budget test (isolated env)
    ├── server.test.ts          # in-process MCP protocol tests (InMemoryTransport)
    ├── multiTenant.test.ts     # real HTTP requests, key isolation, crash-safety
    └── liveApiCheck.ts         # LIVE check against the real API — run manually
admin/                    # Admin dashboard SOURCE (React/Tailwind/shadcn) — see admin/README.md
api/
└── mcp.ts                # Vercel serverless function entry point
openapi/
└── renshuu.openapi.json   # The real spec, fetched live — source of truth
.github/
├── workflows/
│   ├── test.yml               # runs the full offline suite on every push/PR
│   └── monthly-api-check.yml  # monthly: spec-drift detection + optional live check
vercel.json
```

**Why the client is split from the MCP layer:** `src/renshuu/client.ts` +
`types.ts` + `errors.ts` + `budgetRegistry.ts` have no MCP imports at all.
Copy those files into any other Node/TypeScript project and use
`RenshuuClient` directly:

```ts
import { RenshuuClient } from "./renshuu/client.js";

const client = new RenshuuClient({ apiKey: theUsersOwnKey });
const profile = await client.getProfile();
console.log(profile.level_progress_percs.vocab.n2); // % of N2 vocab complete
```

## Tools implemented (all 15 real endpoints covered)

| Tool | Type | Real endpoint |
|---|---|---|
| `renshuu_get_profile` | read | `GET /profile` (includes what would elsewhere be "stats") |
| `renshuu_get_schedules` | read | `GET /schedule` |
| `renshuu_get_schedule` | read | `GET /schedule/{id}` |
| `renshuu_get_schedule_terms` | read | `GET /schedule/{id}/list` |
| `renshuu_get_lists` | read | `GET /lists` |
| `renshuu_get_list_contents` | read | `GET /list/{id}` |
| `renshuu_get_all_studied_terms` | read | `GET /list/all/{termtype}` |
| `renshuu_search_words` | read | `GET /word/search` |
| `renshuu_get_word` | read | `GET /word/{id}` |
| `renshuu_search_kanji` | read | `GET /kanji/search` |
| `renshuu_get_kanji` | read | `GET /kanji/{character}` |
| `renshuu_search_grammar` | read | `GET /grammar/search` |
| `renshuu_get_grammar` | read | `GET /grammar/{id}` |
| `renshuu_search_sentences` | read | `GET /reibun/search` |
| `renshuu_get_sentences_for_word` | read | `GET /reibun/search/{word_id}` |
| `renshuu_add_term` | **write** | `PUT /word\|kanji\|grammar/{id}` |
| `renshuu_remove_term` | **write** | `DELETE /word\|kanji\|grammar/{id}` |
| `renshuu_get_jlpt_progress` | read (composite) | `/profile` + `/schedule` combined |
| `renshuu_get_item_progress` | read (composite) | search/get, surfaces embedded `user_data`/`presence` |

## Local setup

```bash
npm install
cp .env.example .env    # fill in RENSHUU_API_KEY (used for stdio mode / your own testing)
npm run build
npm start                # stdio transport, for Claude Desktop or local testing
```

## Testing — everything below actually runs and passes

Four layers, in increasing order of realism:

**1. Unit tests (offline, mocked HTTP)**
Every `RenshuuClient` method: correct URL/path construction (including the
kanji-by-character encoding and the `/schedule` vs `/schedules` distinction
that were wrong in an earlier guessed version), correct query params, every
error path (401/403/404/429/network failure/non-JSON body), and the
per-key rate-limit budget.

**2. In-process MCP protocol tests (offline, real MCP layer)**
Uses the MCP SDK's `InMemoryTransport` to wire a real `McpServer` to a real
`Client` in-process. Catches things client-only tests can't: duplicate tool
names, broken Zod schemas, a tool handler that throws instead of returning
`isError`.

**3. Multi-tenant HTTP tests (offline, real HTTP requests on an ephemeral port)**
Starts the actual `createHttpApp()` Express app on a random local port and
issues real `fetch()` requests against it — not just function calls. Proves:
a missing key returns `401` without crashing the process; two different
keys sent concurrently never cross-contaminate; CORS preflight works.

**Run all three together:**
```bash
npm test
```

**4. Live check against the real API (uses your real key and quota)**
```bash
npm run test:live               # read-only, ~9 requests
npm run test:live:mutations     # also adds+immediately-removes a term (net no-op, but a real write)
```

## OAuth — per-user auth through Claude's connector UI

Claude's custom connector UI doesn't support a custom per-user request
header, which is what `X-Renshuu-Api-Key` (above) needs. What it does
support is standard OAuth 2.1 + PKCE with Dynamic Client Registration
(RFC 7591), so this server implements that too — each person who adds the
connector gets sent to a login page (hosted by this server) asking for
their own renshuu API key, verifies it against renshuu's real API, and
from then on Claude sends `Authorization: Bearer <token>` instead of the
custom header. Decrypting that token recovers the same renshuu key the
header path always carried — OAuth is additive, not a replacement.

No database: every OAuth artifact (client registration, authorization
code, access token, refresh token) is a self-contained encrypted JWE —
see `src/oauth/crypto.ts` for why (short version: Vercel functions don't
share memory between invocations, so an in-memory store silently breaks in
production). Requires `OAUTH_ENCRYPTION_KEY` (see Environment variables
below) — generate with `openssl rand -base64 32`. Losing/rotating that key
invalidates every issued token at once; everyone has to reconnect.

## Admin dashboard

`GET /admin` — a full analytics dashboard: requests over time, per-tool
usage, OAuth vs. header vs. env-fallback auth mix, live activity feed,
error feed, a pseudonymous per-user table, and the OAuth connection funnel
(registrations → logins → tokens issued).

Protected by its own login (`ADMIN_USERNAME` / `ADMIN_PASSWORD` — pick
your own, nothing to sign up for), completely separate from renshuu
accounts and OAuth. Timing-safe credential check, signed session cookie.

Requires Upstash Redis (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
— free tier at upstash.com) for actual data — REST-based, not a persistent
connection, which is what makes it work from a serverless function at all.
Without these set, the server and OAuth still work exactly the same; the
dashboard just shows zeros. No user's real renshuu API key ever reaches
the dashboard, even server-side — every user shown is a one-way SHA-256
hash of their key (`src/analytics/hash.ts`), never the key itself.

The dashboard itself (React + Tailwind + shadcn-pattern components) lives
in `admin/` as source, but is built once and embedded as a plain string in
`src/admin/dashboardHtml.ts` — see that file's header and `admin/README.md`
for why, and for how to rebuild it after making changes.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `RENSHUU_API_KEY` | Single-tenant fallback | Optional. Used only if a request has no header and no OAuth token. |
| `OAUTH_ENCRYPTION_KEY` | OAuth | `openssl rand -base64 32`. Rotating it invalidates all issued tokens. |
| `OAUTH_ISSUER_URL` | OAuth (rarely) | Only if the auto-detected public URL is ever wrong behind a proxy. |
| `UPSTASH_REDIS_REST_URL` | Admin dashboard data | Free tier at upstash.com. |
| `UPSTASH_REDIS_REST_TOKEN` | Admin dashboard data | From the same Upstash database's REST API tab. |
| `ADMIN_USERNAME` | Admin dashboard login | Your own choice — not a signup. |
| `ADMIN_PASSWORD` | Admin dashboard login | Your own choice — not a signup. |
| `TRANSPORT` | Local/Docker only | `stdio` (default) or `http`. Unused on Vercel. |
| `PORT` | Local/Docker only | Unused on Vercel — Vercel handles the HTTP layer itself. |

## Deploying

### Option A: Vercel (serverless, multi-tenant HTTP)

```bash
vercel deploy
```

`vercel.json` routes all traffic to a single function (`api/mcp.ts`)
which just re-exports the same `createHttpApp()` Express app used
everywhere else — no duplicated logic. It imports directly from the
TypeScript source (`src/index.js`), not a separate compiled `dist/`
output, so there's no build-ordering dependency between `vercel.json`'s
`buildCommand` and the function bundler. (An earlier version of this file
was named `api/index.ts` and imported from `dist/` — that combination
caused every route to 404 on a real deployment; fixed here.)

**Previously broken, now fixed — the `"No Output Directory named 'public'"`
error:** `package.json` has a `"build": "tsc"` script. `vercel.json` used
to set `"buildCommand": null`, which in Vercel's config means *auto-detect*,
not *skip*. So Vercel ran `tsc` (which only produces `dist/`, no static
output), then — with no framework detected — looked for a `public/`
directory to serve statically, didn't find one, and failed the deploy.

This project doesn't need Vercel to run `tsc` at all: `api/mcp.ts` already
imports the TypeScript source directly, and Vercel's own Node.js function
bundler compiles it as part of tracing that function's import graph. The
`tsc` build is only needed for local `npm start` / Docker / `npm test`, not
for this deployment path. Fixed by telling Vercel to skip the build step
entirely (`"buildCommand": ""`, which is documented to skip the step,
unlike `null`) and pointing `outputDirectory` at a minimal `public/`
folder rather than leaving it ambiguous. `vercel.json` now reads:

```json
{
  "framework": null,
  "buildCommand": "",
  "outputDirectory": "public",
  "rewrites": [{ "source": "/(.*)", "destination": "/api/mcp" }],
  "functions": { "api/mcp.ts": { "maxDuration": 30 } }
}
```

If a deploy still fails with this exact error after pulling this fix, the
next thing to check is Vercel's dashboard, not the code: **Project Settings
→ Build and Deployment → Build Command / Output Directory** each have their
own **Override** toggle. If either is switched on with a stale value, it
takes precedence over `vercel.json` for that field specifically. Turn the
override off (or match it to the values above) and redeploy.

Set `RENSHUU_API_KEY` in Vercel's dashboard (Project Settings → Environment
Variables) **only** if you want a single-tenant fallback for your own
testing — for real multi-user traffic, each caller sends their own key via
the `X-Renshuu-Api-Key` header, and no environment variable is involved at
all for them.

Worth knowing: Vercel functions cold-start, so the in-memory rate-limit
budget resets more often here than on a persistent host — this doesn't
affect correctness (see the Multi-tenant section above), only how often
the local courtesy guard actually catches anything before Renshuu's own
429 does.

### Option B: Docker (persistent server — Render, Fly.io, Railway, a VPS)

```bash
docker build -t renshuu-mcp .
docker run -p 3000:3000 --env-file .env renshuu-mcp
```

Same multi-tenant behavior as Vercel — the only difference is the process
stays warm, so the rate-limit budget persists for the life of the container
instead of resetting on cold starts.

### Connecting from Claude

**Settings → Connectors → Add connector → Remote**, paste your deployed
URL. Claude's own connector UI doesn't have a built-in per-user secret
field, so this path is naturally single-tenant unless you build your own
frontend/client that sets the `X-Renshuu-Api-Key` header per user before
proxying to this server.

### The Android (Kotlin/Java) bridge

For a native app where each user already has their own key on their own
device, you likely don't need this server in the request path at all —
generate a client directly from `openapi/renshuu.openapi.json` and call
renshuu straight from the app:

```bash
npx @openapitools/openapi-generator-cli generate \
  -i openapi/renshuu.openapi.json \
  -g kotlin \
  -o ./android-renshuu-client \
  --additional-properties=library=jvm-okhttp4
```

The spec's security scheme is `bearerAuth` (confirmed) — the generated
client expects the key via its standard bearer-token config.

## GitHub Actions (CI)

**`.github/workflows/test.yml`** — runs the full offline suite (all three
layers above) on every push and PR, across Node 20 and 22. No secrets
required.

**`.github/workflows/monthly-api-check.yml`** — the "document updation"
workflow, runs on the 1st of every month (and on-demand via the Actions
tab):
  - Fetches the live spec from `api.renshuu.org/api-docs` (no auth needed —
    confirmed publicly accessible) and diffs it against the committed
    `openapi/renshuu.openapi.json`. If anything changed, it opens a PR with
    the updated spec file and clear instructions **not** to auto-merge —
    a human needs to review what changed and update `client.ts`/`types.ts`
    accordingly before merging.
  - A second, optional job runs the live functional check
    (`liveApiCheck.ts`) against a real account if you've added a
    `RENSHUU_API_KEY` repository secret (Settings → Secrets and variables →
    Actions). This is a **maintainer's own test key**, unrelated to the
    per-user keys used in production traffic — it's purely for CI health
    monitoring. The job skips cleanly if the secret isn't set.

## Known real API behavior (from the spec + live probing)

- Adding/removing a term that's already present/absent returns `409`, not `200`.
- Kanji search (`/kanji/search`) returns lightweight summaries only; use
  `renshuu_get_kanji` on the specific character for full detail including
  personal mastery data.
- A term's `user_data` field is only present if you've actually added that
  term to a list/schedule at some point — `renshuu_get_item_progress`
  reports this as `mastery: null`, not an error.
- `GET /word/{id}` returns the same wrapped shape as search
  (`{ result_count, words: [...] }`), even for one item.
- **Fixed bug (previously wrong in this codebase):** the `termtype` enum
  used by `/lists` and `/list/all/{termtype}` is confirmed as exactly
  `vocab | kanji | grammar | semt` — an earlier version of this code
  incorrectly included a non-existent `sent` value (confused with an
  unrelated `sent` category used elsewhere, in profile stats) and was
  missing the real `semt` value entirely, meaning `renshuu_get_all_studied_terms`
  could never actually be called with the one real 4th category. Fixed in
  `types.ts` and `tools/lists.ts`; covered by a regression test in
  `server.test.ts`. `semt`'s actual content (possibly idioms/set phrases,
  unconfirmed) is still an open investigation — call the tool with
  `termtype: "semt"` against a real account to find out.
- Word entries carry `pitch` (real pitch-accent notation) and `markers`
  (which may include a JLPT-level tag like `"JLPT N5"`, alongside frequency
  tags) — both are now explicitly surfaced by `renshuu_search_words`,
  `renshuu_get_word`, and `renshuu_get_item_progress`, not just present in
  the raw type definitions.
