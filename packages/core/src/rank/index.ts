import type { PlaceEvent, SourceId } from "@hereabouts/contracts";
import { closestApproach, etaSeconds } from "../geo/index.js";
import type { Mode } from "../mode/index.js";

/**
 * Ranking (PLAN.md §7.4): a weighted blend of ETA fit, ahead-ness,
 * notability, topic affinity, novelty, and source quality. Weights are a
 * plain config object per mode — tunable without a deploy, as the brief
 * requires — not a hard-coded formula. Each mode's weights sum to 1 for
 * interpretability, though nothing enforces that; `scorePlace` just computes
 * a weighted sum, so retuning is a config edit, not a code change.
 */
export interface RankWeights {
  eta: number;
  ahead: number;
  notability: number;
  topic: number;
  novelty: number;
  source: number;
}

export const DEFAULT_WEIGHTS_BY_MODE: Record<Mode, RankWeights> = {
  stationary: { eta: 0.05, ahead: 0.05, notability: 0.4, topic: 0.2, novelty: 0.2, source: 0.1 },
  walking: { eta: 0.15, ahead: 0.2, notability: 0.3, topic: 0.15, novelty: 0.1, source: 0.1 },
  biking: { eta: 0.25, ahead: 0.3, notability: 0.2, topic: 0.1, novelty: 0.1, source: 0.05 },
  driving: { eta: 0.35, ahead: 0.35, notability: 0.1, topic: 0.05, novelty: 0.1, source: 0.05 },
};

/**
 * Per-source quality score used *inside ranking*. Distinct from
 * `packages/core/dedup`'s `SOURCE_PREFERENCE_RANK`, which only picks a
 * cluster's preferred record — the two orderings happen to agree, but nothing
 * requires that, since they answer different questions.
 */
export const SOURCE_QUALITY_SCORE: Record<SourceId, number> = {
  wikipedia: 1,
  loc: 0.85,
  nrhp: 0.8,
  wikidata: 0.6,
  osm: 0.5,
};

/**
 * How well an ETA fits the "prepared queue" window a story needs to play
 * before the user arrives (PLAN.md §7.4/§7.5): flat at 1.0 across 40-120s,
 * ramping up to that plateau below 40s, and decaying above 120s. A
 * non-finite ETA (stationary, or moving directly away) scores 0 — there's
 * no meaningful "arrival" to time narration against.
 */
export function etaFit(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  if (seconds <= 40) return seconds / 40;
  if (seconds <= 120) return 1;
  return Math.max(0, 1 - (seconds - 120) / 280);
}

export interface RankObserver {
  lat: number;
  lon: number;
  headingDeg: number;
  speedMps: number;
}

export interface RankContext {
  mode: Mode;
  /**
   * Place ids already served this trip. PLAN.md §7.4 lists novelty as a
   * ranking dimension, but the "never repeat in the same trip" rule (an MVP
   * acceptance criterion) is enforced as a hard pre-filter by the caller
   * (apps/api), not by scoring alone — so in practice every place reaching
   * `rankPlaces` already has novelty 1. The dimension stays in the formula
   * for fidelity to the design and so a future change to that filtering
   * policy (e.g. allowing a long-idle place to resurface) doesn't require
   * touching the scoring code.
   */
  heardIds: ReadonlySet<string>;
  /** Topics the user has favored via filters (PLAN.md's V1 topic filters — ranking weight, never a hard hide). */
  preferredTopics?: readonly string[];
  weights?: RankWeights;
}

export interface RankedPlace {
  place: PlaceEvent;
  score: number;
  distanceM: number;
  etaSeconds: number;
  aheadness: number;
}

function topicAffinity(place: PlaceEvent, preferredTopics: readonly string[] | undefined): number {
  if (!preferredTopics || preferredTopics.length === 0) return 0.5; // no preference expressed: neutral
  const hasMatch = place.topics.some((topic) => preferredTopics.includes(topic));
  return hasMatch ? 1 : 0.2; // weight, never a hard filter — an unmatched topic still competes
}

function noveltyOf(place: PlaceEvent, heardIds: ReadonlySet<string>): number {
  return heardIds.has(place.id) ? 0 : 1;
}

/** Scores one place against an observer's position/heading/speed. */
export function scorePlace(place: PlaceEvent, observer: RankObserver, ctx: RankContext): RankedPlace {
  const weights = ctx.weights ?? DEFAULT_WEIGHTS_BY_MODE[ctx.mode];
  const { distanceM, aheadness } = closestApproach(observer, observer.headingDeg, place);
  const eta = etaSeconds(distanceM, observer.speedMps);

  const score =
    weights.eta * etaFit(eta) +
    weights.ahead * aheadness +
    weights.notability * place.notability +
    weights.topic * topicAffinity(place, ctx.preferredTopics) +
    weights.novelty * noveltyOf(place, ctx.heardIds) +
    weights.source * SOURCE_QUALITY_SCORE[place.source];

  return { place, score, distanceM, etaSeconds: eta, aheadness };
}

/** Scores and sorts places descending by score — the ranked candidate queue (PLAN.md §7.4). */
export function rankPlaces(
  places: readonly PlaceEvent[],
  observer: RankObserver,
  ctx: RankContext,
): RankedPlace[] {
  return places.map((place) => scorePlace(place, observer, ctx)).sort((a, b) => b.score - a.score);
}
