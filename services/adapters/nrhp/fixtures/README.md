# NRHP adapter — verification status

There's no `fixtures/*.json` here because this adapter has no live HTTP call
to fixture — see `../src/dataset.ts`'s own header comment for the full
explanation. Short version:

- The real source is a **bulk spatial dataset** (NPS IRMA portal / ArcGIS
  Hub — SOURCES.md §5), not a per-request API, and this environment can't
  reach `public-nps.opendata.arcgis.com` to download it (§16.1).
- There's also no Postgres wiring yet to load a bulk dataset into (that's
  still deferred).
- `dataset.ts` is a small, explicitly-illustrative placeholder standing in
  for the real bulk table, so `queryNearby`'s spatial-filter/normalise logic
  has something to run against and be tested with.

**Before this adapter is considered done:**

1. Obtain the real NRHP spatial dataset (bulk download, one-off, from an
   environment that can reach the ArcGIS Hub endpoint).
2. Map its actual field names into `NrhpRecord` (`refNumber`, `name`, `lat`,
   `lon`, `listedYear`, `significance`) — **this mapping doesn't exist yet**,
   since this build has never seen the real dataset's schema. Don't assume
   the field names guessed at elsewhere in this codebase are correct.
3. Confirm the `sourceUrl` pattern
   (`https://npgallery.nps.gov/NRHP/AssetDetail?assetID=<refNumber>`) is
   real — it's an educated guess, not a verified deep-link scheme.
4. Replace `SAMPLE_NRHP_RECORDS` with the real dataset (or load it via the
   `dataset` parameter `queryNearby` already accepts for exactly this swap).
