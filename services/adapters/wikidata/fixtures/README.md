# Fixtures — verification status

**Hand-authored, not recorded from a live call — and confidence here is
lower than the Wikipedia adapter's fixtures.** This environment cannot
reach `query.wikidata.org` (§16.1/SOURCES.md "Egress allowlist"). For a REST
API like Wikipedia's, the main risk is the *response shape* drifting. For a
SPARQL endpoint, there's a second, harder-to-verify-by-reading risk: the
**query syntax itself** might not do what it's intended to do, even though
each individual clause (`SERVICE wikibase:around`, `geof:distance`, the
`psv:`/`wikibase:timeValue`/`wikibase:timePrecision` path for statement
qualifiers, `schema:about`/`schema:isPartOf` for sitelinks) is a documented,
standard WDQS pattern. I'm confident in each piece; I have not run the
composed query.

**Before this adapter is considered done**, from a machine that *can* reach
WDQS: paste the query strings `buildNearbyItemsQuery` /
`buildNearestSettlementQuery` produce (log them, or call the exported
builder directly) into https://query.wikidata.org/ and confirm:

1. `fetchNearbyItems`'s query returns items with coordinates *and* an
   inception date, ordered by distance, without timing out.
2. `fetchNearestSettlement`'s query returns a real nearby settlement with a
   real English Wikipedia sitelink title.
3. Response field names (`item`, `itemLabel`, `location`, `dist`, `date`,
   `datePrecision`, `articleTitle`) match this file's fixtures exactly —
   SPARQL result JSON is shaped by the query's own `SELECT` clause, so this
   should hold as long as the query text itself is unchanged, but it's
   worth checking once against a real response.

## The nearest-settlement approximation

`fetchNearestSettlement` answers "what's the nearest human-settlement-typed
Wikidata item" — not "what administrative area contains this point."
WDQS has no cheap point-in-polygon query, so this is a deliberate
simplification of PLAN.md §7.6's full city → county → state cascade down to
one practical tier. It's usually right (settlements are typically the
nearest settlement-typed item to a point inside them) but can be wrong near
a boundary. Revisit if regional gap-filler framing turns out to say the
wrong town's name near borders.

## Sample QIDs are illustrative, not verified facts

`Q7677026`, `Q12345678`, `Q49233`, and the dates/coordinates attached to
them in these fixtures are plausible-looking placeholders for exercising
the adapter's parsing, not claims about real Wikidata items. Don't treat
them as verified facts about Tampa or its landmarks.
