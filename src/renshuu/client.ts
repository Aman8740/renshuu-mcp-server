/**
 * Core renshuu API client.
 *
 * Endpoints, param names, and response shapes below are confirmed against
 * the real OpenAPI spec fetched live from https://api.renshuu.org/api-docs
 * with a working API key on 2026-07-12. This is ground truth, not a
 * reconstruction — see /openapi/renshuu.openapi.json for the raw spec this
 * was built from.
 *
 * Zero dependency on MCP — copy this file plus types.ts and errors.ts into
 * any other Node/TypeScript project to use RenshuuClient directly.
 *
 * For Android (Kotlin/Java): run openapi/renshuu.openapi.json through
 * OpenAPI Generator (`-g kotlin` or `-g java`) for a native typed client
 * with the same endpoint coverage — see README for the exact command.
 */

import {
  AUTH_HEADER_NAME,
  AUTH_HEADER_SCHEME,
  DAILY_REQUEST_LIMIT,
  RENSHUU_BASE_URL,
} from "../constants.js";
import { getBudgetFor } from "./budgetRegistry.js";
import { RenshuuApiError, RenshuuAuthError } from "./errors.js";
import type {
  AllStudiedTermsResponse,
  Grammar,
  GrammarSearchResponse,
  Kanji,
  KanjiSearchResponse,
  List,
  ListsGroupedResponse,
  PresenceMutationParams,
  ProfileResponse,
  ReibunSearchResponse,
  Schedule,
  ScheduleTermsResponse,
  ScheduleGroup,
  TermType,
  WordSearchResponse,
} from "../types.js";

export interface RenshuuClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class RenshuuClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RenshuuClientOptions) {
    if (!options.apiKey) {
      throw new RenshuuAuthError();
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? RENSHUU_BASE_URL;
    // Wrapped in a closure rather than `options.fetchImpl ?? fetch` so that,
    // when no override is given, this always calls whatever `fetch` is at
    // CALL time, not whatever it was when the client was constructed. This
    // matters for tests that reassign global.fetch after building a client
    // (e.g. a long-lived MCP server test harness), and is a safer default
    // in general.
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  get requestsUsedToday(): number {
    return getBudgetFor(this.apiKey).used;
  }

  private async request<T>(
    method: "GET" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | number | undefined> } = {}
  ): Promise<T> {
    getBudgetFor(this.apiKey).consume(DAILY_REQUEST_LIMIT);

    const url = new URL(`${this.baseUrl}${path}`);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          [AUTH_HEADER_NAME]: `${AUTH_HEADER_SCHEME} ${this.apiKey}`,
          Accept: "application/json",
        },
      });
    } catch (err) {
      throw new RenshuuApiError(
        `Network error calling renshuu API: ${err instanceof Error ? err.message : String(err)}`,
        { endpoint: path }
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new RenshuuAuthError();
    }
    if (response.status === 429) {
      throw new RenshuuApiError("renshuu API returned 429 (server-side rate limit).", {
        status: 429,
        endpoint: path,
      });
    }

    const text = await response.text();
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw new RenshuuApiError(`renshuu API request to ${path} failed with status ${response.status}.`, {
        status: response.status,
        endpoint: path,
        body: data,
      });
    }

    return data as T;
  }

  // ---- Profile (also carries study stats / JLPT-level progress / streaks) --

  /**
   * GET /profile — no separate /stats endpoint exists. This response
   * includes `studied` (today's/total counts), `level_progress_percs`
   * (percent complete per JLPT level, per category — the most direct
   * signal for "am I ready for N2"), and `streaks`.
   */
  getProfile(): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("GET", "/profile");
  }

  // ---- Schedules (GET /schedule, singular — NOT /schedules) ---------------

  getSchedules(): Promise<{ schedules: Schedule[] }> {
    return this.request<{ schedules: Schedule[] }>("GET", "/schedule");
  }

  getSchedule(id: string): Promise<{ schedules: Schedule[] }> {
    return this.request<{ schedules: Schedule[] }>("GET", `/schedule/${id}`);
  }

  /** GET /schedule/{id}/list — the terms inside a schedule, with optional group filter. */
  getScheduleTerms(
    id: string,
    opts: { pg?: number; group?: ScheduleGroup } = {}
  ): Promise<ScheduleTermsResponse> {
    return this.request<ScheduleTermsResponse>("GET", `/schedule/${id}/list`, {
      query: { pg: opts.pg, group: opts.group },
    });
  }

  // ---- Lists (GET /lists for all, GET /list/{id} for one) -----------------

  getLists(): Promise<ListsGroupedResponse> {
    return this.request<ListsGroupedResponse>("GET", "/lists");
  }

  getListContents(id: string, opts: { pg?: number } = {}): Promise<List> {
    return this.request<List>("GET", `/list/${id}`, { query: { pg: opts.pg } });
  }

  /** GET /list/all/{termtype} — every term of a type the user has ever studied. */
  getAllStudiedTerms(
    termtype: TermType,
    opts: { pg?: number } = {}
  ): Promise<AllStudiedTermsResponse> {
    return this.request<AllStudiedTermsResponse>("GET", `/list/all/${termtype}`, {
      query: { pg: opts.pg },
    });
  }

  // ---- Words ----------------------------------------------------------

  /** GET /word/search — param is `value`, not `search`. */
  searchWords(value: string, pg = 1): Promise<WordSearchResponse> {
    return this.request<WordSearchResponse>("GET", "/word/search", { query: { value, pg } });
  }

  getWord(id: string): Promise<WordSearchResponse> {
    return this.request<WordSearchResponse>("GET", `/word/${id}`);
  }

  addWordTo(id: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("PUT", `/word/${id}`, { query: target as Record<string, string | undefined> });
  }

  removeWordFrom(id: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("DELETE", `/word/${id}`, { query: target as Record<string, string | undefined> });
  }

  // ---- Kanji (looked up by the CHARACTER itself, not a numeric id) --------

  searchKanji(value: string): Promise<KanjiSearchResponse> {
    return this.request<KanjiSearchResponse>("GET", "/kanji/search", { query: { value } });
  }

  getKanji(kanjiChar: string): Promise<Kanji> {
    return this.request<Kanji>("GET", `/kanji/${encodeURIComponent(kanjiChar)}`);
  }

  addKanjiTo(kanjiChar: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("PUT", `/kanji/${encodeURIComponent(kanjiChar)}`, {
      query: target as Record<string, string | undefined>,
    });
  }

  removeKanjiFrom(kanjiChar: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("DELETE", `/kanji/${encodeURIComponent(kanjiChar)}`, {
      query: target as Record<string, string | undefined>,
    });
  }

  // ---- Grammar -----------------------------------------------------------

  searchGrammar(value: string, pg = 1): Promise<GrammarSearchResponse> {
    return this.request<GrammarSearchResponse>("GET", "/grammar/search", { query: { value, pg } });
  }

  getGrammar(id: string): Promise<Grammar> {
    return this.request<Grammar>("GET", `/grammar/${id}`);
  }

  addGrammarTo(id: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("PUT", `/grammar/${id}`, { query: target as Record<string, string | undefined> });
  }

  removeGrammarFrom(id: string, target: PresenceMutationParams): Promise<unknown> {
    return this.request("DELETE", `/grammar/${id}`, {
      query: target as Record<string, string | undefined>,
    });
  }

  // ---- Example sentences (reibun) -----------------------------------------

  searchSentences(value: string): Promise<ReibunSearchResponse> {
    return this.request<ReibunSearchResponse>("GET", "/reibun/search", { query: { value } });
  }

  getSentencesForWord(wordId: string): Promise<ReibunSearchResponse> {
    return this.request<ReibunSearchResponse>("GET", `/reibun/search/${wordId}`);
  }
}
