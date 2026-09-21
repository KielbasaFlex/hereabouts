/**
 * Topic classification (PLAN.md's V1 "topic filters" feature, Milestone 4).
 *
 * None of the four source adapters carry a ready-made category field that's
 * both present on every source *and* free to fetch: Wikipedia's categories
 * and Wikidata's instance-of (P31) would each need an extra live API call
 * this environment can't verify any more than the calls already made
 * (§16.1), and OSM's own tags are already folded into English prose by
 * `services/adapters/overpass`'s `buildExcerpt`. So this classifies from
 * the text every adapter already has — `title` + `summary`/`sourceExcerpt`
 * — against a small fixed keyword vocabulary. Approximate by design, same
 * tradeoff `packages/core/grounding`'s entity check makes: a pure,
 * dependency-free, explainable heuristic instead of a real NLP/classifier
 * call, good enough for a ranking *affinity* signal (a soft preference,
 * never a hard filter — see `rank/index.ts`) rather than a ground truth
 * label.
 */

export const TOPIC_IDS = [
  "military",
  "religious",
  "government-civic",
  "industrial",
  "transportation",
  "education",
  "arts-culture",
  "maritime",
  "residential",
  "commemorative",
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

/** Display labels for the topic-filter UI (`apps/web`). */
export const TOPIC_LABELS: Record<TopicId, string> = {
  military: "Military & War",
  religious: "Religious Sites",
  "government-civic": "Government & Civic",
  industrial: "Industry & Commerce",
  transportation: "Transportation",
  education: "Education",
  "arts-culture": "Arts & Culture",
  maritime: "Maritime",
  residential: "Homes & Residences",
  commemorative: "Memorials & Monuments",
};

const TOPIC_KEYWORDS: Record<TopicId, string[]> = {
  military: [
    "war",
    "battle",
    "battlefield",
    "fort",
    "fortress",
    "army",
    "navy",
    "military",
    "soldier",
    "regiment",
    "garrison",
    "confederate",
    "veterans",
  ],
  religious: [
    "church",
    "cathedral",
    "chapel",
    "synagogue",
    "mosque",
    "temple",
    "parish",
    "monastery",
    "mission",
    "congregation",
  ],
  "government-civic": [
    "courthouse",
    "capitol",
    "city hall",
    "town hall",
    "government",
    "county",
    "municipal",
    "post office",
    "statehouse",
  ],
  industrial: [
    "mill",
    "factory",
    "mine",
    "foundry",
    "warehouse",
    "industrial",
    "manufacturing",
    "textile",
    "ironworks",
  ],
  transportation: [
    "railroad",
    "railway",
    "bridge",
    "canal",
    "station",
    "depot",
    "highway",
    "tunnel",
    "ferry",
    "streetcar",
    "trolley",
    "turnpike",
  ],
  education: ["school", "schoolhouse", "university", "college", "academy", "library"],
  "arts-culture": ["theatre", "theater", "museum", "gallery", "opera", "auditorium"],
  maritime: ["lighthouse", "harbor", "harbour", "wharf", "dock", "shipyard", "maritime"],
  residential: ["mansion", "residence", "plantation", "farmstead", "homestead", "house"],
  commemorative: ["memorial", "monument", "plaque", "cemetery", "gravesite", "statue"],
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOPIC_PATTERNS: Record<TopicId, RegExp[]> = Object.fromEntries(
  TOPIC_IDS.map((topic) => [
    topic,
    TOPIC_KEYWORDS[topic].map((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i")),
  ]),
) as Record<TopicId, RegExp[]>;

/**
 * Classifies free text into zero or more {@link TopicId}s by keyword match.
 * Order of the result follows {@link TOPIC_IDS}, not match strength — there's
 * no scoring here, just presence.
 */
export function classifyTopics(text: string): TopicId[] {
  return TOPIC_IDS.filter((topic) => TOPIC_PATTERNS[topic].some((pattern) => pattern.test(text)));
}
