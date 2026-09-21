# Milestone 3 eval set

This is the "eval hill-climb" the user asked for when resolving the runtime-model
question: a small, hand-picked fixture set (`fixtures.ts`) run against the real
model, graded by the same Layer 2 deterministic validators
(`@hereabouts/core`'s `validateGrounding`) used in production, with the Layer 3
judge (`claude-haiku-4-5-20251001`) run alongside it so the two can be compared
rather than one silently gating the other.

## Why this hasn't been run in this environment

This sandbox has no `ANTHROPIC_API_KEY` configured. `api.anthropic.com` itself
*is* reachable through the environment's egress proxy (confirmed during
Milestone 3 — it's in the proxy's `noProxy` list, unlike `en.wikipedia.org`,
`query.wikidata.org`, `overpass-api.de`, and `public-nps.opendata.arcgis.com`,
all of which are blocked), but every request needs a real credential to get
past Anthropic's own auth, and none exists here. `run.ts` has been written and
typechecks against the real SDK types, but it has never executed a real model
call — see the main Milestone 3 write-up for what *has* been verified against
the live-but-unauthenticated API (request construction, the SDK's own
client-side validation, and the resilience fallback path).

## How to run it once a key exists

```sh
export ANTHROPIC_API_KEY=sk-ant-...
pnpm --filter @hereabouts/storytelling exec tsx eval/run.ts
```

This calls `generateNarration` (claude-sonnet-5) and `judgeNarration`
(claude-haiku-4-5-20251001) once per fixture — 6 fixtures × 2 calls = 12 API
calls per run — and prints, per fixture:

- the generated narration and its word count and citation count
- the Layer 2 verdict (pass, or the specific check(s) that failed)
- the Layer 3 judge's verdict (`allFactsSupported`, `mirrorsSourcePhrasing`,
  and the first unsupported claim if any)

## What this is meant to answer

1. **Does claude-sonnet-5 reliably clear the grounding bar?** The fixture set
   deliberately stresses each Layer 2 check individually: numeric precision
   (`numeric-heavy-biking`), decade-vagueness preservation
   (`vague-decade-walking`), regional-framing correctness
   (`regional-gap-filler-style`), and the length/grounding tension under a
   very thin source (`thin-source-driving`). A low Layer 2 pass rate here
   would mean either the prompt needs tightening or the regenerate-once
   policy in `build-story.ts` isn't enough headroom.

2. **Does claude-haiku-4-5-20251001 judge paraphrase-mirroring reliably?**
   This was the user's explicit ask ("test claude-haiku-4-5-20251001 for
   validation"). The comparison that matters is whether the judge's
   `mirrorsSourcePhrasing` verdict agrees with Layer 2's n-gram overlap
   check (`checkPhraseOverlap` in `packages/core/src/grounding`) on the same
   narration. If they disagree often — especially if the judge misses
   mirroring that the n-gram check catches, or flags mirroring on narration
   that's actually just using unavoidable factual boilerplate — that's a
   concrete signal for which one should be the check of record, per the
   design note already in `judge.ts`.

3. **Does the difficult-history fixture get handled well?**
   `difficult-history-walking` (a fictional 1920s labor-strike fixture with a
   fatality) has no automated check for tone — this one needs a human to
   actually read the output and judge whether it followed the "factual,
   non-sensationalized, no forced uplift" instruction in the system prompt.

None of this changes what ships in Milestone 3: the production path
(`build-story.ts`) already fails safe (regenerate once, then the template
extractive fallback) regardless of what this eval finds. This eval is for
tuning the prompt and comparing the two models, not a merge gate.
