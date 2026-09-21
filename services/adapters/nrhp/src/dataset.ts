/**
 * Placeholder local NRHP dataset — **not the real bulk download.**
 *
 * PLAN.md §5 / SOURCES.md §5 call for a periodic bulk load of the real NRHP
 * public dataset (NPS IRMA portal / ArcGIS Hub) into Postgres. This
 * environment cannot reach `public-nps.opendata.arcgis.com` (§16.1), and
 * there is no Postgres wiring yet (still deferred past Milestone 2 — see
 * PLAN.md), so this file stands in for that pipeline with a small,
 * hand-authored, illustrative dataset.
 *
 * **These records are not verified historical facts.** Names, reference
 * numbers, dates, and coordinates below are plausible-looking placeholders
 * for exercising `queryNearby`'s parsing and spatial filtering — do not
 * narrate them to a user as real NRHP listings. Replace this file (or feed
 * `queryNearby` a real dataset — see its `dataset` parameter) once the real
 * bulk download has been mapped into {@link NrhpRecord}[]; that mapping
 * itself is an open task, since this build has never seen the real
 * dataset's actual field names to map from.
 */

export interface NrhpRecord {
  /** NRHP reference number, e.g. "73000001". Placeholder format here, not a real registry number. */
  refNumber: string;
  name: string;
  lat: number;
  lon: number;
  /** Year listed on the Register, when known. */
  listedYear?: number;
  /** Free-text significance/period note, when known. */
  significance?: string;
}

export const SAMPLE_NRHP_RECORDS: NrhpRecord[] = [
  {
    refNumber: "SAMPLE0001",
    name: "Sample Historic Courthouse (placeholder)",
    lat: 27.951,
    lon: -82.4568,
    listedYear: 1979,
    significance: "Example of early 20th-century civic architecture (illustrative placeholder record).",
  },
  {
    refNumber: "SAMPLE0002",
    name: "Sample Riverfront Warehouse District (placeholder)",
    lat: 27.9498,
    lon: -82.4583,
    listedYear: 1985,
  },
  {
    refNumber: "SAMPLE0003",
    name: "Sample Coastal Lighthouse (placeholder)",
    lat: 27.775,
    lon: -82.635,
    listedYear: 1972,
    significance: "Example of 19th-century maritime navigation infrastructure (illustrative placeholder record).",
  },
  {
    refNumber: "SAMPLE0004",
    name: "Sample Rural Schoolhouse (placeholder)",
    lat: 28.3,
    lon: -81.9,
  },
];
