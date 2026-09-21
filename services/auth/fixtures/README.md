# Fixtures — verification status

**Hand-authored, not recorded from a live call — but a different confidence
story than most of this project's fixtures.** `accounts.google.com`,
`oauth2.googleapis.com`, `github.com`, and `api.github.com` are all
*reachable* from this environment (confirmed directly — unlike
`en.wikipedia.org`/`query.wikidata.org`/`overpass-api.de`/
`router.project-osrm.org`, which get a 403 at CONNECT). What's actually
missing is a registered OAuth application (a real `client_id`/`client_secret`
pair from a Google Cloud project or a GitHub OAuth App) and a reachable
public callback URL for the provider to redirect back to — neither of which
exists in this sandboxed session regardless of network policy.

Confidence in the request/response shapes themselves is **high**: Google's
OAuth2/OIDC token and userinfo endpoints and GitHub's OAuth Apps token/user
endpoints have been stable and publicly documented for years — closer to
the OSRM adapter's confidence tier than the Wikidata adapter's
composed-query risk.

**Before this is considered done**, with a real registered OAuth app on
each provider and a public callback URL:

1. Complete a real browser consent flow for both providers and confirm
   `exchangeGoogleCode`/`exchangeGitHubCode` parse the real token/profile
   responses without needing changes.
2. Confirm GitHub's private-email fallback (`github-user-private-email.json`
   + `github-emails.json` here) actually happens for an account configured
   with a private email — this fixture pair exercises the *code path*, not
   a confirmed-real account.
3. Confirm `state` round-trips correctly through each provider's redirect
   (CSRF protection) once real routes exist to receive the callback —
   `apps/api` doesn't wire up `/auth/callback/google` or
   `/auth/callback/github` routes in this milestone; only the URL-building
   and code-exchange functions exist. See `PLAN.md`'s Milestone 6 caveats.

All sample account ids, emails, and names in these fixtures are
placeholders, not real accounts.
