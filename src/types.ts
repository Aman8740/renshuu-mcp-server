/**
 * Type definitions for renshuu API resources.
 *
 * Corrected against the REAL OpenAPI spec discovered live from
 * https://api.renshuu.org/api-docs (fetched with a real API key on
 * 2026-07-12). This replaces the earlier forum-post reconstruction —
 * field names and endpoint shapes here are ground truth, not guesses.
 */

export type TermType = "vocab" | "kanji" | "grammar" | "semt";
export type ListPrivacy = "public" | "private";
export type ScheduleGroup =
  | "all"
  | "blocked"
  | "studied"
  | "notyetstudied"
  | "cannot_study"
  | "review_today"
  | "mastery_1"
  | "mastery_2"
  | "mastery_3"
  | "mastery_4"
  | "mastery_5"
  | "mastery_6"
  | "mastery_7"
  | "mastery_8"
  | "mastery_9";

// ---- Shared building blocks -------------------------------------------

/** Localized text, e.g. { en: "..." } — renshuu supports multiple UI languages. */
export type LocalizedText = Record<string, string>;

export interface StudyVector {
  name: string;
  correct_count: number;
  missed_count: number;
  mastery_perc: number;
  last_quizzed: string;
  next_quiz: string;
}

/**
 * Personal mastery data for a single term. THIS is the answer to "how well
 * do I know this word/kanji/grammar point" — it comes back embedded
 * directly in every Word/Kanji/Grammar object from search/get calls, no
 * separate lookup needed.
 */
export interface TermUserData {
  correct_count: number;
  missed_count: number;
  mastery_avg_perc: number;
  study_vectors: Record<string, StudyVector>;
}

export interface PresenceSchedule {
  sched_id: number;
  name: string;
  /** 1 if this term is present in that schedule, 0 otherwise. */
  hasWord: number;
}

export interface PresenceList {
  list_id: number;
  name: string;
  set_name: string;
  hasWord: number;
}

/** Which of the user's own lists/schedules this term currently belongs to. */
export interface Presences {
  scheds: PresenceSchedule[];
  lists: PresenceList[];
}

// ---- Dictionary term schemas -------------------------------------------

export interface SimpleWord {
  term: string;
  def: string;
}

export interface Word {
  is_common?: boolean;
  kanji_full: string;
  hiragana_full: string;
  id: string;
  reibuns?: string;
  aforms?: string[];
  edict_ent?: string;
  pic?: string[];
  config?: string[];
  markers?: string[];
  pitch?: string[];
  notes?: string[];
  typeofspeech?: string;
  presence?: Presences;
  user_data?: TermUserData;
  def: string[];
}

export interface SimpleKanji {
  id: string;
  kanji: string;
  definition: string;
}

export interface Kanji {
  id: string;
  kanji: string;
  scount?: string;
  definition: string;
  radical?: string;
  radical_name?: string;
  onyomi?: string;
  kunyomi?: string;
  kanken?: string;
  jlpt?: string;
  rwords?: Array<{ reading: string; words: SimpleWord[] }>;
  parts?: Array<{ piece: string; definition: string }>;
  presence?: Presences;
  user_data?: TermUserData;
}

export interface Grammar {
  id: string;
  title_english: string;
  title_japanese: string;
  url?: string;
  meaning: LocalizedText;
  meaning_long?: LocalizedText;
  presence?: Presences;
  user_data?: TermUserData;
  models?: Array<{ japanese: string; hiragana: string; meanings: LocalizedText }>;
  /** Image URL of the construction pattern, suitable for embedding. */
  construct?: string;
}

export interface SimpleSentence {
  id: string;
  japanese: string;
  hiragana?: string;
  meaning: LocalizedText;
}

// ---- Schedules -----------------------------------------------------------

export interface Schedule {
  id: string;
  name: string;
  is_frozen: number;
  today: { review: number; new: number };
  upcoming: Array<{ days_in_future: number; terms_to_review: number }>;
  terms: {
    total_count: number;
    studied_count: number;
    unstudied_count: number;
    hidden_count: number;
  };
  new_terms: { today_count: number; rolling_week_count: number };
}

export type AnyTerm = Word | Kanji | Grammar | SimpleSentence;

export interface TermPage {
  result_count: number;
  total_pg: number;
  per_pg: number;
  pg: number;
  group?: string;
  terms: AnyTerm[];
}

export interface ScheduleTermsResponse {
  schedules: Schedule[];
  contents: TermPage;
}

// ---- Lists -----------------------------------------------------------

export interface List {
  list_id: number;
  title: string;
  description?: string;
  termtype: TermType;
  num_terms: number;
  privacy: ListPrivacy;
  contents: TermPage;
}

export interface ListsGroupedResponse {
  termtype_groups: Array<{
    termtype: TermType;
    list_count: number;
    groups: Array<{
      list_count: number;
      group_title: string;
      lists: List[];
    }>;
  }>;
}

export interface AllStudiedTermsResponse {
  contents: TermPage;
}

// ---- Search / lookup response wrappers ----------------------------------

export interface WordSearchResponse {
  result_count: number;
  total_pg: number;
  per_pg: number;
  pg: number;
  query: string;
  words: Word[];
}

export interface KanjiSearchResponse {
  result_count: number;
  kanjis: SimpleKanji[];
}

export interface GrammarSearchResponse {
  result_count: number;
  total_pg: number;
  per_pg: number;
  pg: number;
  grammar: Grammar[];
}

export interface ReibunSearchResponse {
  result_count: number;
  pg: number;
  perPage: number;
  reibuns: SimpleSentence[];
}

// ---- Profile (this also carries what would elsewhere be "stats") --------

export interface LevelProgressBlock {
  n1?: number;
  n2?: number;
  n3?: number;
  n4?: number;
  n5?: number;
  n6?: number;
  kana?: number;
  kata?: number;
}

export interface StreakBlock {
  correct_in_a_row: number;
  correct_in_a_row_alltime: number;
  days_studied_in_a_row: number;
  days_studied_in_a_row_alltime: number;
}

export interface ProfileResponse {
  id: number;
  real_name: string;
  adventure_level: number;
  user_length: string;
  kao: string;
  studied: {
    today_all: number;
    today_vocab: number;
    today_grammar: number;
    today_kanji: number;
    today_sent: number;
    today_conj: number;
    today_aconj: number;
    total?: number;
    total_vocab?: number;
    total_kanji?: number;
    total_grammar?: number;
    total_sent?: number;
  };
  level_progress_percs: {
    vocab: LevelProgressBlock;
    kanji: LevelProgressBlock;
    grammar: LevelProgressBlock;
    sent: LevelProgressBlock;
  };
  streaks: {
    vocab: StreakBlock;
    kanji: StreakBlock;
    grammar: StreakBlock;
    sent: StreakBlock;
    conj: StreakBlock;
    aconj: StreakBlock;
  };
  api_usage?: { calls_today: string; daily_allowance: number };
}

// ---- Add/remove (per-resource PUT/DELETE, not a generic endpoint) -------

export interface PresenceMutationParams {
  list_id?: string;
  sched_id?: string;
}
