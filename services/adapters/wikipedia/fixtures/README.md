# Fixtures — verification status

**These fixtures are hand-authored from the documented MediaWiki API response
shape (`formatversion=2`), not recorded from a live call.** This build
environment cannot reach `en.wikipedia.org` (see `PLAN.md` §16.1 /
`SOURCES.md` "Egress allowlist") — every attempt so far has hit a 403 at the
egress proxy's CONNECT step.

The field names and nesting here (`query.geosearch[]`, `query.pages[]`,
`dist`, `extract`, `fullurl`, `missing`) are stable, long-documented parts of
the MediaWiki Action API, which is why SOURCES.md grades this source
**High** confidence. But "high confidence in the docs" is not the same as
"verified," and the adapter's parsing has not been exercised against a real
response.

**Before this adapter is considered done**, replace or supplement these with
real recordings — e.g. from a machine that *can* reach the API:

```bash
curl -s -A "$UA" 'https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=27.9478%7C-82.4590&gsradius=2000&gslimit=10&format=json&formatversion=2'
curl -s -A "$UA" 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts%7Cinfo&inprop=url&exintro=1&explaintext=1&exchars=600&pageids=<ids>&format=json&formatversion=2'
```

and confirm the adapter's tests still pass unmodified against the real
payloads (or update the fixtures if the shape has drifted).
