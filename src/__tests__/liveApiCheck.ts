/**
 * LIVE integration check — hits the REAL renshuu API using RENSHUU_API_KEY
 * from your environment/.env. This is NOT part of `npm test` (which only
 * runs the offline mocked *.test.js files) — run it deliberately:
 *
 *   npm run build
 *   node dist/__tests__/liveApiCheck.js
 *
 * By default this only calls READ-ONLY endpoints, so it cannot modify your
 * renshuu account. It uses a small number of real requests (well under the
 * ~500/day cap) and prints a pass/fail line per check.
 *
 * To ALSO exercise the mutating add/remove endpoints (renshuu_add_term /
 * renshuu_remove_term equivalents), pass --with-mutations. When enabled,
 * the script only ever adds a term to a list/schedule and then immediately
 * removes it again in the same run, so your account ends up unchanged —
 * but this is still a real write against your real data, hence opt-in.
 */

import "dotenv/config";
import { RenshuuClient } from "../renshuu/client.js";
import { RenshuuApiError, RenshuuAuthError } from "../renshuu/errors.js";

const WITH_MUTATIONS = process.argv.includes("--with-mutations");

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  PASS  ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.RENSHUU_API_KEY;
  if (!apiKey) {
    console.error("RENSHUU_API_KEY not set. Add it to .env or the environment first.");
    process.exit(1);
  }

  const client = new RenshuuClient({ apiKey });

  console.log(`Running live checks against the real renshuu API (mutations: ${WITH_MUTATIONS ? "ON" : "OFF"})\n`);

  await check("getProfile", async () => {
    const p = await client.getProfile();
    if (typeof p.id !== "number") throw new Error("response missing numeric 'id' field");
    return `user id ${p.id}, adventure_level ${p.adventure_level}`;
  });

  await check("getSchedules", async () => {
    const s = await client.getSchedules();
    if (!Array.isArray(s.schedules)) throw new Error("response missing 'schedules' array");
    return `${s.schedules.length} schedule(s)`;
  });

  await check("getLists", async () => {
    const l = await client.getLists();
    if (!Array.isArray(l.termtype_groups)) throw new Error("response missing 'termtype_groups' array");
    return `${l.termtype_groups.length} termtype group(s)`;
  });

  let sampleWordId: string | undefined;
  await check("searchWords('食べる')", async () => {
    const r = await client.searchWords("食べる", 1);
    if (!Array.isArray(r.words)) throw new Error("response missing 'words' array");
    sampleWordId = r.words[0]?.id;
    return `${r.result_count} result(s), sample id=${sampleWordId ?? "none"}`;
  });

  await check("getKanji('食')", async () => {
    const k = await client.getKanji("食");
    if (k.kanji !== "食") throw new Error(`expected kanji '食', got '${k.kanji}'`);
    return `definition: ${k.definition}`;
  });

  await check("searchGrammar('ながら')", async () => {
    const g = await client.searchGrammar("ながら", 1);
    if (!Array.isArray(g.grammar)) throw new Error("response missing 'grammar' array");
    return `${g.result_count} result(s)`;
  });

  await check("searchSentences('食べる')", async () => {
    const r = await client.searchSentences("食べる");
    if (!Array.isArray(r.reibuns)) throw new Error("response missing 'reibuns' array");
    return `${r.result_count} result(s)`;
  });

  if (sampleWordId) {
    await check("getSentencesForWord(sampleWordId)", async () => {
      const r = await client.getSentencesForWord(sampleWordId!);
      return `${r.result_count} result(s) for word id ${sampleWordId}`;
    });
  }

  await check("getAllStudiedTerms('kanji')", async () => {
    const r = await client.getAllStudiedTerms("kanji", { pg: 1 });
    return `total_pg=${r.contents?.total_pg ?? "?"}`;
  });

  if (WITH_MUTATIONS) {
    console.log("\n--- mutation checks (add, then immediately remove) ---");
    let scheduleId: string | undefined;
    await check("getSchedules (for mutation target)", async () => {
      const s = await client.getSchedules();
      scheduleId = s.schedules[0]?.id;
      if (!scheduleId) throw new Error("no schedule available to test against — skipping mutation checks");
      return `using schedule id ${scheduleId}`;
    });

    if (scheduleId && sampleWordId) {
      await check("addWordTo + removeWordFrom (round trip, net no-op)", async () => {
        await client.addWordTo(sampleWordId!, { sched_id: scheduleId });
        await client.removeWordFrom(sampleWordId!, { sched_id: scheduleId });
        return `word ${sampleWordId} added then removed from schedule ${scheduleId} — account left unchanged`;
      });
    }
  } else {
    console.log("\n(skipping mutation checks — pass --with-mutations to include them)");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof RenshuuAuthError) {
    console.error(`\nAuth failed: ${err.message}`);
  } else if (err instanceof RenshuuApiError) {
    console.error(`\nAPI error: ${err.message}`);
  } else {
    console.error("\nUnexpected error:", err);
  }
  process.exit(1);
});
