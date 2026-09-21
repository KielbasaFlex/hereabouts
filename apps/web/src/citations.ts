import type { Citation } from "@hereabouts/contracts";

/**
 * Splits `sourceExcerpt` into plain and cited segments for rendering
 * (Milestone 4's "citation highlighting" in the text card's expandable
 * excerpt — PLAN.md §9). `Citation.startCharIndex`/`endCharIndex` index into
 * the source document as sent to the Citations API, which is exactly
 * `sourceExcerpt` — see `services/storytelling/src/generate.ts`.
 *
 * Defensive by design: citations come from the model's own response
 * (`packages/contracts`'s zod schema only checks the indices are
 * non-negative integers, not that they fall inside the text or don't
 * overlap), so out-of-range or overlapping spans are clamped/merged rather
 * than trusted to slice cleanly.
 */
export interface CitationSegment {
  text: string;
  cited: boolean;
}

export function buildHighlightedSegments(text: string, citations: readonly Citation[]): CitationSegment[] {
  const ranges = citations
    .map((c) => ({
      start: Math.max(0, Math.min(c.startCharIndex, text.length)),
      end: Math.max(0, Math.min(c.endCharIndex, text.length)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  if (merged.length === 0) return [{ text, cited: false }];

  const segments: CitationSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), cited: false });
    segments.push({ text: text.slice(range.start, range.end), cited: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), cited: false });

  return segments;
}
