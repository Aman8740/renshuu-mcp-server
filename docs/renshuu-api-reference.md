# Renshuu API — Reference Notes

Compiled from renshuu's own developer forum thread and several open-source
clients built against the API (Ruby gem, Chrome extensions, a Rust client).
The live Swagger UI (`https://api.renshuu.org/docs/`) blocks automated
fetching, so treat this as a strong starting map, not a verbatim spec —
confirm exact field names against the Swagger UI yourself before building
anything that depends on precision.

## Base info

- Base URL: `https://api.renshuu.org` (all endpoints under `/v1/`)
- Auth: API key, found in-app under **Resources > renshuu API**
  (also referenced as Tools > Renshuu API in older UI versions)
- Two key types are issued: a **read-only** key and a **read/write** key.
  Use read-only unless you actually need to modify lists/schedules.
- Rate limit: **~500 requests/day** per key
- Quizzing/SRS-scoring logic is deliberately **not** exposed via the API —
  confirmed directly by the developer, and unlikely to change
- The API is overwhelmingly GET-based; only list/schedule membership
  actions are POST/PUT/DELETE

## Endpoints (confirmed via forum + client libraries)

### Profile & stats
- `GET /v1/stats?window=...` → `{ user, total_xp, level, statistics: [{ type, terms, questions, correct, new_terms, window }] }`
  - `type` values include at least `grammar` (presumably also `word`, `kanji`)
  - `window` values include at least `today` (likely also week/month/all-time)
- Profile retrieval exists (`Renshuu::Profile.get` in the Ruby gem) — exact
  path not confirmed, likely `GET /v1/profile` or similar

### Schedules (Renshuu's spaced-repetition study queues)
- `GET /v1/schedules` → list of subscribed schedules with `name`, `review`, `learn` counts
- `GET /v1/schedule/:id` → specific schedule metadata
- Schedule contents support pagination and grouping (e.g. `group: review_today`)

### Personal lists
- `GET /v1/list` → user's personal lists
- List contents also paginated

### Dictionaries (word / kanji / grammar / reibun/sentences)
- `GET /v1/word/:id`, search variant for word lookup
- `GET /v1/kanji/:id`, search variant for kanji lookup
- `GET /v1/grammar/:id`, search variant for grammar lookup
  - Known limitation: grammar search has been capped at 25 results with no
    paging support in past versions
- `GET /v1/reibun` (example sentences) — supports search by word or by word ID
- Dictionary GETs (word/kanji/grammar lookup) work **without** authentication
  for pure lookups; auth is required for anything touching your personal
  lists/schedules

### Modifying lists/schedules
- Adding/removing a word, kanji, or grammar entry to a list or schedule is
  exposed as an action on the resource itself in client libraries
  (`word.add_to_list(list)`, `word.remove_from_list(list)`, same pattern
  for kanji and grammar)
- A generalized action endpoint was proposed/discussed as
  `POST /v1/presence/adjust/:id` with body `{ schedule_id, action: "add"|"remove" }`
  — check the Swagger UI to confirm this shipped as-is
- Historical bug (may be fixed by now): adding to a schedule worked but
  deleting did not, tied to a `hasWord` flag that was stuck at 0

### Challenges
- `GET /v1/challenges` → daily challenge list with `time_left` and per-challenge name/link

## Known quirks worth checking before you build on them
- `GET /v1/word/:id` has historically returned `total_pg: 0` regardless of
  actual page count
- No official OpenAPI/YAML spec has been confirmed as publicly published,
  despite at least one developer requesting one — worth checking the
  Swagger UI directly for a `/docs/openapi.json` style export if you want
  to generate a client automatically

## What this is good for (relevant to JLPT tracking specifically)
The `/v1/stats` endpoint's `statistics` array (broken down by `type`:
grammar/word/kanji, with `terms`, `correct`, `new_terms`) is the most
direct lever for a "how ready am I for N2" tool — it gives you accuracy
and volume, not just exposure count. Combine that with `/v1/schedules`
to see what's actually due vs. mastered.

## For an actual live connector later
Since this is nearly all GET/read endpoints, the lowest-effort real
connector would be a small MCP server wrapping these calls (using
FastMCP in Python or the MCP SDK in Node). If you want that built,
say so in a future session and reference this file — it has everything
needed to scaffold the tool definitions.
