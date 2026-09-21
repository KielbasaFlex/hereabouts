import type { PlaceEvent } from "@hereabouts/contracts";
import type { Mode, SpatialFrame } from "@hereabouts/core";

/**
 * The Milestone 3 eval set (PLAN.md §14/§8.4): a small, hand-picked spread
 * of source material across modes, topics, and difficulty, meant to be run
 * against a real model once a credential is available — see `README.md` in
 * this directory for why that hasn't happened yet in this environment, and
 * exactly how to run it once it can.
 *
 * Every place below is **explicitly fictional** — synthetic source
 * material, not a real historical claim — for the same reason the NRHP
 * adapter's placeholder dataset is: this eval only needs source text to
 * check narration against, not real facts, and inventing clearly-labeled
 * fixtures sidesteps any risk of misstating real history.
 */

function place(overrides: Partial<PlaceEvent> & Pick<PlaceEvent, "id" | "title" | "sourceExcerpt" | "datePrecision">): PlaceEvent {
  return {
    source: "wikipedia",
    sourceId: overrides.id,
    lat: 0,
    lon: 0,
    summary: overrides.sourceExcerpt,
    sourceUrl: "https://example.org/eval-fixture",
    license: "cc-by-sa-4.0",
    topics: [],
    notability: 0.5,
    externalIds: {},
    isRegional: false,
    ...overrides,
  };
}

export interface EvalFixture {
  id: string;
  description: string;
  place: PlaceEvent;
  mode: Mode;
  spatialFrame: SpatialFrame;
}

const DIRECTIONAL: SpatialFrame = { allow: "directional", distanceM: 30, side: "left" };
const PROXIMAL: SpatialFrame = { allow: "proximal", distanceM: 600, side: null };
const REGIONAL: SpatialFrame = { allow: "regional", distanceM: 15000, side: null };

export const EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "architecture-driving",
    description: "Simple architectural fact, tight driving-length target (60-100 words).",
    mode: "driving",
    spatialFrame: PROXIMAL,
    place: place({
      id: "eval:architecture-driving",
      title: "Millbrook Grain Exchange",
      datePrecision: "year",
      sourceExcerpt:
        "The Millbrook Grain Exchange building was completed in 1911. It was designed in the Beaux-Arts style, " +
        "with a domed rotunda that once housed the city's commodity trading floor. The building stopped operating " +
        "as an exchange in 1958 and now houses municipal offices.",
    }),
  },
  {
    id: "numeric-heavy-biking",
    description: "Several specific numbers the narration must not alter or invent, biking length (120-200 words).",
    mode: "biking",
    spatialFrame: DIRECTIONAL,
    place: place({
      id: "eval:numeric-heavy-biking",
      title: "Fairview Suspension Bridge",
      datePrecision: "exact",
      sourceExcerpt:
        "The Fairview Suspension Bridge opened on April 3, 1932. It spans 412 meters and was, at the time, the " +
        "third-longest suspension bridge in the region. Construction cost $2.1 million and employed around 340 " +
        "workers over 26 months. The bridge carries roughly 18,000 vehicles per day as of the most recent count.",
    }),
  },
  {
    id: "difficult-history-walking",
    description: "A hard historical subject — tests factual, non-sensationalized voice handling, walking length (250-300 words).",
    mode: "walking",
    spatialFrame: PROXIMAL,
    place: place({
      id: "eval:difficult-history-walking",
      title: "Riverside Mill Strike of 1922",
      datePrecision: "year",
      sourceExcerpt:
        "In 1922, workers at the Riverside Textile Mill went on strike after wages were cut by 20 percent. The " +
        "strike lasted eleven weeks. During a confrontation on the third week, local police and hired guards " +
        "clashed with picketers; three strikers were killed and dozens were injured. The strike ultimately ended " +
        "with a partial restoration of wages, though the mill closed permanently in 1931. A memorial plaque was " +
        "installed at the site in 1998.",
    }),
  },
  {
    id: "vague-decade-walking",
    description: "Decade-only precision — narration must not sharpen it into a specific year, walking length.",
    mode: "walking",
    spatialFrame: REGIONAL,
    place: place({
      id: "eval:vague-decade-walking",
      title: "Cedar Hollow Schoolhouse",
      datePrecision: "decade",
      eraText: "the 1880s",
      sourceExcerpt:
        "The Cedar Hollow Schoolhouse was built in the 1880s to serve the growing farming community nearby. It " +
        "operated as a one-room schoolhouse until consolidation efforts closed it, and the building later served " +
        "as a community meeting hall.",
    }),
  },
  {
    id: "thin-source-driving",
    description: "Very little source material against a tight length target — stresses the length/grounding tension directly.",
    mode: "driving",
    spatialFrame: DIRECTIONAL,
    place: place({
      id: "eval:thin-source-driving",
      title: "Founders' Well",
      datePrecision: "unknown",
      sourceExcerpt: "Founders' Well is the town's original water source, dug by early settlers.",
    }),
  },
  {
    id: "regional-gap-filler-style",
    description: "Regional framing (as the gap filler would produce) — narration must never claim 'right here'.",
    mode: "driving",
    spatialFrame: REGIONAL,
    place: place({
      id: "eval:regional-gap-filler-style",
      title: "Elmsworth County",
      datePrecision: "century",
      sourceExcerpt:
        "Elmsworth County was established in the 19th century and was originally home to several logging " +
        "settlements along the Miller River before shifting to agriculture in the following decades.",
    }),
  },
];
