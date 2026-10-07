<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Sessions vs Tokens

> Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Sessions vs Tokens" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/sessions-vs-tokens.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Sign-in** | **Session:** the app server checks Ana's credentials, writes a record to the session store (session ID, user, roles, expiry) and sends the browser only a random session ID, in a cookie marked `HttpOnly`, `Secure` and `SameSite`. **Token:** the client signs in at the issuer, which signs a token that carries the same facts as claims (`sub`, `roles`, `exp`) and hands it to the client; the API servers keep nothing. |
| **2 · Every request** | **Session:** the browser sends the cookie with every request, and the app server reads the session row by its ID before it does anything else: one round trip to the store per request. **Token:** the client sends the token with every request, and the API server checks the signature with the issuer's public key and then the claims, all locally and with no lookup. |
| **3 · Scale out** | **Session:** requests can land on any app server, so every one of them must reach the same store (or the load balancer must pin each user to one server), and that store sits on the hot path of every request. **Token:** any API server, or any other service the token is meant for, can verify it on its own; nothing is shared but the issuer's public keys. |
| **4 · Revoke** | Ana signs out, her credential is stolen or her role changes, and access has to end now. **Session:** delete the row and the very next request is refused. **Token:** it keeps passing every check until `exp`; the fixes are short lifetimes renewed with refresh tokens, or a denylist or introspection call on each request, which brings the lookup back. |
<!-- END GENERATED: header -->

## The problem

HTTP forgets the caller between requests. Once Ana has signed in, every later request still has to answer two questions: who is this, and what may they do? Something has to carry that answer from one request to the next, and there are two places to keep it.

- **On the server.** The server keeps a session record and hands the client a meaningless pointer to it. The server stays in control of every session, and every request starts with a lookup.
- **In the credential.** An issuer signs the facts into a token, and whoever receives the token can check it without asking anyone. Nothing is looked up, and nothing can be taken back.

The choice decides where the state lives, what each request costs, what your servers have to share when you scale out, and how fast you can cut someone off: the four steps of the diagram. It is also less of a choice than it looks, because most real systems end up using both.

## How it works

**Server-side session.** At sign-in the app server creates a record in a session store (who the user is, their roles, when the session ends, plus whatever else the app wants to remember) and sends the browser the record's key: a long random **session ID** in a cookie. The browser returns that cookie with every request to the site, with no code involved. The server reads the record by its ID, and the request is authenticated. The ID carries no information, so there is nothing in it to read or to forge; it only has to be impossible to guess. Ending the session means deleting the record.

**Self-contained token.** At sign-in an issuer, usually an OAuth 2.0 authorization server, puts the same facts into a set of **claims** (`sub`, roles or `scope`, `exp`), signs them with its private key and hands the result to the client, typically as a JWT (RFC 7519; RFC 9068 is the profile for OAuth access tokens). The client sends the token with each request in the `Authorization: Bearer` header. Any API that holds the issuer's public key checks the signature and the claims by itself, with no call to the issuer or to a database; [JWT Validation](../jwt-validation/) walks through those checks. The API keeps nothing per user. The price is that the token stays valid until `exp`, whatever happens in the meantime.

| | Server-side session | Self-contained token |
|---|---|---|
| The state lives | in the session store | in the token, held by the client |
| The client holds | an opaque random ID | signed claims, readable by whoever holds them |
| Each request costs | one store lookup, a network round trip | one signature check, CPU only |
| Servers must share | the store, or sticky sessions | the issuer's public keys |
| A sign-out or role change applies | on the next request | when the token expires |
| Travels as | a cookie, attached by the browser | a header, attached by the client's code |
| Size on every request | a few dozen bytes | hundreds of bytes, sometimes kilobytes |

### It is not either/or

The two models are the ends of a range, and real systems mix them:

- **A session for the browser, tokens between services.** A [backend for frontend](../backends-for-frontends/) keeps the OAuth tokens on the server, gives the browser only a session cookie, and adds the access token on the server side when it forwards a call to the APIs. RFC 10017, the IETF's best current practice for browser-based apps, strongly recommends it for business applications, for sensitive ones and for any that handle personal data. Signing in with [OpenID Connect](../openid-connect/) has the same shape: the app validates the ID token once and then runs its own session.
- **Opaque tokens with introspection.** An access token doesn't have to be self-contained. The issuer can hand out a random handle and let each API ask what it stands for at the introspection endpoint (RFC 7662). That is a session by another name: nothing leaks to the client, revocation is immediate, and every request costs a lookup. A common variant lets the [API gateway](../api-gateway/) do that lookup and forward a JWT to the services behind it, so the client holds a reference and the services still verify locally (Curity calls it the phantom token approach).
- **Session data in a signed or encrypted cookie.** The server packs the session into the cookie and protects it with a key that only it holds. That needs no store, and it is as hard to revoke as a token (see the trade-offs).

## When to use it

**Sessions fit**

- One web application with its own backend, on its own site: a server-rendered app, or a single-page app that talks only to its own API. RFC 10017 makes the point from the OAuth side: such an app often doesn't need access tokens between its frontend and its backend at all, and a server-side cookie session does the job (it can still hand the login itself to an OpenID Connect provider).
- Anything where a sign-out, a locked account or a changed permission has to bite on the very next request: admin consoles, banking, health records.
- When you want to see and manage sessions: list where a user is signed in, sign them out everywhere, limit concurrent sessions.

**Tokens fit**

- APIs called by many services, by mobile apps or by third parties, where the API cannot share a session store with whoever authenticated the caller.
- Calls that cross a boundary between teams, companies or regions. The only thing both sides need is the issuer's public keys.
- Request rates or latency budgets where one more network round trip on every call is too much, and a few minutes of delay in revocation is acceptable.

**Use both** when a browser app sits in front of token-protected APIs: a session cookie between the browser and its backend, tokens from there on.

**Think twice** before replacing sessions with JWTs in a single web app for the sake of being stateless. You trade one store lookup for the revocation problem, larger requests and the question of where the browser keeps the token. OWASP's JWT cheat sheet makes the same argument: once you add a denylist to invalidate sessions, they are no longer stateless, and a plain session system may be the better choice.

## Trade-offs

- **Revocation is the real difference.** Deleting a session row ends access on the next request. A self-contained token cannot be un-issued: RFC 7009 requires authorization servers to support revoking refresh tokens, only recommends it for access tokens, and notes that taking back a self-contained access token at once needs extra, non-standard communication with the API. Decide how long a revoked credential may keep working, then pick the cheapest mechanism that meets it. Each one moves a token-based system back toward a session:
  - *Short lifetimes plus refresh tokens.* The access token lives for minutes, and the issuer can refuse the next refresh. The window shrinks but never closes, and the refresh token becomes the long-lived secret to protect (see refresh token rotation). RFC 10017's worked example pairs a 10-minute access token with an 8-hour refresh token.
  - *A denylist* of revoked token IDs, kept only until those tokens would have expired anyway. It is small, but every API has to consult it on every request, so the shared store is back. OWASP says to key it on `jti` and `iss`, never on the raw token or a hash of it.
  - *Introspection* (RFC 7662): each API asks the issuer whether the token is still active. The answer is always current, at the price of latency, load and a hard runtime dependency on the issuer. Caching the answer, which the RFC allows, reopens the window.
  - *A status list:* the token points into a compressed list that the issuer publishes and verifiers fetch and cache. The IETF's Token Status List draft is approved and waiting in the RFC Editor's queue (October 2026).
  - *Pushed events:* the issuer tells the APIs that subscribed to stop honouring a user's tokens. The OpenID Shared Signals Framework and CAEP, final specifications since September 2025, standardise this. Microsoft Entra's continuous access evaluation is one deployment: tokens may live for up to 28 hours, because a disabled account or a changed password reaches the participating services in near real time (Microsoft says up to 15 minutes).
- **Theft.** A session ID and a bearer token both work for whoever holds them. A stolen session can be deleted the moment the theft is noticed; a stolen token has to run out, unless it was bound to its sender in the first place (DPoP or mutual TLS; see [JWT Validation](../jwt-validation/)).
- **Stale claims.** A token is a snapshot. If Ana's role changes from editor to viewer, the session row can be updated at once, but her token says `editor` until the next one is issued. Put stable facts in tokens and look up anything that changes quickly.
- **The session store is a dependency on the hot path.** Its latency is added to every request, an outage locks everybody out, a store that loses its data signs everybody out, its memory grows with the number of live sessions, and a multi-region deployment has to replicate it or pin users to a region. In return it is the one place that knows every live session.
- **Sticky sessions instead of a shared store.** Keeping sessions in each server's memory and pinning users with [load balancer](../load-balancing/) affinity avoids the store, but it unbalances the load, loses sessions when an instance dies and makes scaling in harder. RFC 10017 names sticky sessions and session replication as the scaling cost of server-side sessions, and for that reason recommends them with a BFF only at small scale.
- **Token size on every request.** A session ID is a few dozen bytes. A signed JWT is typically several hundred at least (an RS256 signature from a 2048-bit key alone is 256 bytes before encoding) and it grows with every role and group. Issuers cap it: Microsoft Entra ID, for one, puts at most 200 groups in a JWT, and beyond that leaves them out and sets an overage marker, so the API has to ask Microsoft Graph instead. The transport has limits too: many servers cap a header field at about 8 KB by default, and a cookie tops out at about 4 KB.
- **Readable by the holder.** A JWT's claims are encoded, not encrypted, so the client and anyone who sees the token can read them. RFC 9068 tells clients not to rely on the content and issuers to assume it is visible. A session ID reveals nothing.
- **Cookies bring CSRF; script-held tokens bring XSS theft.** A browser attaches cookies by itself. That makes cross-site request forgery possible, and it is also what lets `HttpOnly` keep the credential away from scripts. A bearer token in a header is never sent on the browser's own initiative, so it is immune to CSRF, but code has to hold it, and any injected script can read it from wherever that code keeps it. With an `HttpOnly` cookie, injected script can still send requests from the open page but cannot carry the session away.
- **Signed or encrypted cookie sessions sit in between.** Rails' default cookie store, Django's signed-cookie backend, Flask's default session and ASP.NET Core's cookie authentication keep the session data in the cookie itself, so there is no store to run and any server with the key can serve any request. The costs: about 4 KB per cookie; signed is not encrypted (Django's and Flask's cookies can be read by the user, Rails' and ASP.NET Core's are encrypted); and a copied cookie keeps working after sign-out until it expires, as Django's documentation points out. ASP.NET Core's adds that a disabled account stays signed in unless every request is checked against the user database, at a performance cost.

## Implementation notes

- **Session IDs.** Use the framework's session manager instead of writing your own. OWASP's Session Management Cheat Sheet asks for at least 64 bits of entropy from a cryptographically secure generator (16 hexadecimal characters at the very least), and for at least 128 bits if you do generate IDs yourself. The ID must mean nothing, should never travel in a URL, and the server should accept only IDs that it issued.
- **Renew the ID at sign-in** and whenever privileges change. Otherwise an attacker who plants a known ID in the victim's browser before login owns the session afterwards (session fixation).
- **Timeouts**, enforced on the server: an idle timeout and an absolute one. OWASP's typical ranges are 2 to 5 minutes idle for high-value applications and 15 to 30 for low-risk ones, with an absolute limit of 4 to 8 hours for an application used through a working day. In the diagram Ana signs in at noon: her session row expires at 20:00, while her token's `exp` is 12:15.
- **Cookie attributes.** `Secure` and `HttpOnly` always. Set `SameSite` explicitly, because browsers disagree about the default (Chromium-based browsers treat a missing attribute as `Lax`; Firefox and Safari currently do not). `Strict` withholds the cookie on every cross-site request, including a link followed from another site, so the user arrives looking signed out; `Lax` sends it on top-level navigations with safe methods. Add the `__Host-` name prefix: the browser then refuses the cookie unless it is `Secure`, has `Path=/` and has no `Domain`, which ties it to one host. OWASP recommends the prefix for session IDs. RFC 10017 suggests `__Host-Http-` for BFF cookies, a newer prefix that also demands `HttpOnly`; current Chrome and Firefox enforce it, Safari not yet.
- **The cookie standard is in transition.** RFC 6265 (2011) is still the published specification. Its revision, draft-ietf-httpbis-rfc6265bis, which specifies `SameSite` and the `__Secure-` and `__Host-` prefixes, is approved and waiting in the RFC Editor's queue (October 2026). The `__Http-` prefixes come from a later working-group draft.
- **CSRF defences.** OWASP treats `SameSite` mainly as defence in depth, not as the whole answer. Use your framework's built-in protection if it has one; otherwise add a synchronizer token (or a signed double-submit cookie if you keep no server-side state), or check the Fetch Metadata request headers, or require a custom header on API-style endpoints. And never change state on a `GET`. Injected script defeats all of these, so they don't replace XSS defences.
- **Tokens in browsers.** RFC 10017 goes through the options: `localStorage`, `sessionStorage` and IndexedDB can all be read by any script running in the page's origin; keeping tokens in memory limits the exposure but doesn't survive a reload; and no storage trick stops injected script from asking the issuer for fresh tokens. It ranks the architectures accordingly: a backend for frontend first, then a backend that only obtains the tokens, then a browser-only OAuth client, which it advises against wherever business, sensitive or personal data is involved.
- **Token lifetimes.** Keep access tokens short and check what your issuer does by default: Microsoft Entra ID, for example, issues access tokens that last 60 to 90 minutes. For public clients RFC 9700 requires refresh tokens to be either rotated on use or bound to the sender.
- **Audience.** That any service *can* verify a token doesn't mean every service should accept it. RFC 9700 recommends restricting each access token to one API, or to a small set of them, and requires an API to refuse a token that was not meant for it. To call the next API, exchange the token for one addressed to it (token exchange) instead of passing the original along.
- **Session stores.** Redis or Valkey, Memcached or a database table are the usual choices; give each entry a time to live that matches the session timeout. Most frameworks support them: Django stores sessions in the database by default and can put a cache in front, and Spring Session backs the servlet session with Redis or JDBC. Check the defaults before production: express-session, for instance, ships with an in-memory store that its own documentation says is not meant for production, and leaves the cookie's `Secure` attribute off.
- **Sign-out.** For a session: delete the record, then clear the cookie. For tokens: revoke the refresh token at the issuer (RFC 7009), drop the tokens on the client, and accept that access tokens already issued run until `exp` unless one of the mechanisms above is in place. With single sign-on there is one more session at the identity provider; [OpenID Connect](../openid-connect/) covers how logout is propagated.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.

## Related components and services

- [Redis & Valkey](../redis/) — An in-memory data-structure server: cache, session store, rate limiter, leaderboard and lightweight queue in one process.

## References

- [OWASP Cheat Sheet Series — Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [RFC 6265 — HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265)
- [IETF HTTP WG — Cookies: HTTP State Management Mechanism (draft-ietf-httpbis-rfc6265bis, to replace RFC 6265)](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- [MDN — Set-Cookie header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [OWASP Cheat Sheet Series — Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 7662 — OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662)
- [RFC 7009 — OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [RFC 10017 — OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [OWASP Cheat Sheet Series — JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html)
- [IETF OAuth WG — Token Status List (TSL) (draft-ietf-oauth-status-list)](https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/)
- [OpenID Continuous Access Evaluation Profile 1.0](https://openid.net/specs/openid-caep-1_0-final.html)
- [Microsoft Learn — Continuous access evaluation in Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation)
- [Microsoft Learn — Configurable token lifetimes in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes)
- [Microsoft Learn — Configure group claims and app roles in tokens](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles)
- [Django documentation — How to use sessions](https://docs.djangoproject.com/en/stable/topics/http/sessions/)
- [Microsoft Learn — Use cookie authentication without ASP.NET Core Identity](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie)
- [Ruby on Rails Guides — Securing Rails Applications](https://guides.rubyonrails.org/security.html)
- [Curity — Securing APIs with the Phantom Token Approach](https://curity.io/resources/learn/phantom-token-pattern/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
