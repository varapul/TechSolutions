<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# JWT Validation

> APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).

<p align="center"><img src="diagram.svg" alt="Animated diagram: JWT Validation" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/jwt-validation.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Fetch the keys once** | The API is configured with the one issuer it trusts, `https://idp.example`. At startup (or on the first request) it reads that issuer's metadata document, `/.well-known/oauth-authorization-server` (RFC 8414) or OpenID Connect's `/.well-known/openid-configuration`, follows `jwks_uri` and caches the **JWKS**: the issuer's public keys, each with a key ID (`kid`). The private signing key never leaves the issuer, so an API that can verify tokens still cannot mint one. |
| **2 · Verify locally** | A request arrives with `Authorization: Bearer eyJ…`. The API first checks the header: `typ` is `at+jwt` and `alg` is on its own allowlist (never `none`, and never letting the token choose between RSA and HMAC). It then picks the cached key whose `kid` matches and verifies the signature. Only then does it trust the claims: `iss` must equal the configured issuer exactly, `aud` must include this API, `exp` must be in the future (with a small allowance for clock skew), and `scope` decides whether this particular request is allowed. Every check ran against cached keys, so the issuer was never called, and the API answers `200`. |
| **3 · Reject what fails** | Three bad tokens arrive in turn: one whose `exp` has passed, one whose payload was edited after signing (so the signature no longer matches) and one issued for another audience (`aud: billing-api`). Each gets **401** with `WWW-Authenticate: Bearer error="invalid_token"`. A fourth token is perfectly valid but carries only `orders:read`, and the request needs `orders:write`: that is **403** with `error="insufficient_scope"`, because the token is fine and simply doesn't grant enough. |
| **4 · Key rotation** | The issuer starts signing with a new key, `k3`. The next token's `kid` is not in the API's cache, so the API fetches the JWKS again, finds `k3` and verifies the token; the refetch is rate-limited (one fetch, then a cooldown), so tokens with made-up `kid` values can't make the API flood the issuer with requests. The older keys stay published until the tokens they signed have expired. The price of local validation is that a token stays valid until `exp` even if it was revoked a minute ago, so keep access tokens short-lived, or use token introspection where revocation must be immediate. |
<!-- END GENERATED: header -->

## The problem

An API that accepts OAuth 2.0 access tokens has to decide, on every request, whether the token is genuine, meant for it, still in date and sufficient for what is being asked. Asking the authorization server each time (token introspection) gives a fresh answer, but it adds a network round trip to every call and makes the authorization server a runtime dependency of every API: when it is slow or down, so is everything behind it.

A signed JWT lets the API answer the question by itself. The danger is doing half the job. "The signature is valid" does not mean "this token is for me": an API that stops there accepts expired tokens, tokens issued for a different API, ID tokens, and tokens forged by anyone who can steer it to the wrong key or algorithm. The classic JWT attacks exploit missing checks rather than broken cryptography.

## How it works

**The token.** A signed JWT is a JWS (RFC 7515) in compact form: three base64url-encoded parts joined by dots, `header.payload.signature`.

- The **header** says how the token was signed: the algorithm (`alg`), the ID of the key (`kid`) and, for access tokens that follow RFC 9068, the type `at+jwt`.
- The **payload** holds the claims: who issued the token (`iss`), who it is about (`sub`), which API it is for (`aud`), when it expires (`exp`) and what it allows (`scope`). RFC 9068 also requires `client_id`, `iat` and `jti`.
- The **signature** is computed over the encoded header and payload, so changing a single character of either breaks it.

The payload is only encoded, not encrypted. Anyone who holds the token can read every claim: the client, a proxy, a log file. Keep secrets out of it and personal data down to what the API needs. When the claims themselves must stay confidential, use an encrypted JWT (JWE, RFC 7516) or an opaque token.

**The keys.** The API is configured with the issuer it trusts and derives everything else from that. It reads the issuer's metadata at `/.well-known/oauth-authorization-server` (RFC 8414) or `/.well-known/openid-configuration` (OpenID Connect Discovery), checks that the document's `issuer` is identical to the one it asked for, and downloads the JWK Set (RFC 7517) from `jwks_uri`. The set holds public keys only, each with a `kid`; the private key that signs stays with the issuer.

**The checks, in order.** RFC 7519 §7.2 covers parsing and signature validation, RFC 8725 adds the hardening rules, and RFC 9068 §4 lists what a resource server must check on an access token. The standards leave the order open where steps don't depend on each other, but libraries verify the signature before they read a claim, because until then the payload is attacker-controlled input:

1. **Header.** Reject anything that is not three well-formed parts. `alg` must be on the API's own allowlist for this issuer (only `RS256`, say), which rules out `none` and stops the token from choosing the algorithm family. For RFC 9068 tokens, `typ` must be `at+jwt` or `application/at+jwt`, compared case-insensitively.
2. **Key.** Take the key whose `kid` matches from this issuer's cached JWKS, and only from there.
3. **Signature.** Verify it over the encoded header and payload, with that key and that algorithm.
4. **`iss`** must equal the configured issuer exactly, as a string.
5. **`aud`** must contain an identifier this API accepts for itself. It can be one string or an array; a token with no `aud`, or only with other audiences, is rejected.
6. **`exp`** must be in the future, and `nbf`, when present, in the past. Allow a small leeway for clock skew.
7. **Authorize.** Only now use `scope`, roles or other claims to decide whether this particular request is allowed.

Any failure in steps 1 to 6 is a **401** with `WWW-Authenticate: Bearer error="invalid_token"`. A valid token without the required scope is a **403** with `error="insufficient_scope"`, optionally naming the scope that is needed (RFC 6750 §3.1). A request with no token at all gets a plain challenge, `WWW-Authenticate: Bearer realm="…"`, with no error code.

**Rotation.** An issuer rolls its keys by adding a new one to the JWK Set, signing with it under a new `kid`, and keeping recently retired keys published for a while (OpenID Connect Core §10.1.1): long enough to cover the tokens they signed. The API caches the set, and when a token arrives with a `kid` it doesn't know, it fetches the set again before deciding. That refetch has to be rate-limited, or anyone can make the API hammer the issuer by sending tokens with random `kid` values.

## When to use it

- APIs and microservices behind an OAuth 2.0 or OpenID Connect authorization server that issues JWT access tokens. [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) shows how a client gets one.
- High request rates and latency-sensitive paths, where a call to the authorization server per request costs too much.
- Many APIs sharing one issuer: each verifies on its own with public keys, and none of them can mint a token.
- Not where revocation has to take effect at once. Use introspection for those calls (see the trade-offs).
- Not in the client. RFC 9068 says the client must not inspect the access token: its format is a matter between the issuer and the API, and it can change or become opaque at any time.
- Not for tokens that aren't yours. Some issuers' tokens for their own APIs are not meant to be validated by anyone else; Microsoft Graph's, for example, use a proprietary format.

## Trade-offs

- **Revocation lags.** A locally validated token stays valid until `exp`, even if the user signed out or the grant was revoked a minute ago. The standard answer is short-lived access tokens (minutes, not days) renewed with refresh tokens. Where that isn't enough, call the introspection endpoint for sensitive operations, or keep a small denylist of revoked `jti` values that expires with the tokens.
- **Local validation, introspection or opaque tokens.** Local validation needs no network call, but it only knows what was true when the token was issued. Introspection (RFC 7662) asks the authorization server whether the token is still `active`: always current, at the cost of latency, load and one more dependency on every request. The RFC allows caching the answer, which brings the stale window back. Opaque tokens carry no claims at all, so nothing leaks and revocation is immediate, but every API has to introspect.
- **A bearer token works for whoever holds it.** A token stolen from a log, a browser or a compromised service can be replayed until it expires. Sender-constrained tokens bind the token to a key that only the legitimate client holds: DPoP (RFC 9449) sends a signed proof with every request and puts the key's thumbprint in the token (`cnf.jkt`), and mutual-TLS certificate-bound tokens (RFC 8705) carry the thumbprint of the client certificate (`cnf.x5t#S256`). The API then checks the proof or the certificate as well as the token. RFC 9700 recommends sender-constraining access tokens.
- **Asymmetric or symmetric signing.** With RS256, ES256 or EdDSA an API holds only public keys. With HS256 every verifier holds the very secret that signs, so any API, or anyone who compromises one, can mint tokens for all the others. Keep HMAC for the case where the issuer is the only verifier.
- **Claims are a snapshot.** Roles, groups and permissions in the token are as old as the token, and every claim travels on every request, readable by whoever sees it.

## Implementation notes

- **Use a maintained library** and configure it explicitly with the issuer, the audience and the allowed algorithms; don't parse and verify tokens by hand. Examples: jose (JavaScript), PyJWT or joserfc (Python), Nimbus JOSE + JWT and Spring Security's resource server support (Java), Microsoft.IdentityModel (.NET), golang-jwt or lestrrat-go/jwx (Go). Check what the defaults leave out: Envoy's JWT filter, for one, does not check the audience unless you list the audiences you accept. A token issued for another audience belongs in your test suite.
- **The classic attacks, and the check that stops each one:**
  - *`alg: none`.* The attacker strips the signature and declares the token unsigned. The algorithm allowlist stops it. Use an allowlist, not a blocklist: libraries that blocked only the exact string `none` but read `alg` case-insensitively have been bypassed with `noNE`.
  - *RS256 to HS256 key confusion.* The attacker signs with HMAC, using the issuer's public key as the secret, and a library that lets the token pick the algorithm verifies it (CVE-2015-9235). One key, one algorithm: never accept HMAC for a key published as RSA or EC.
  - *Keys named by the token.* The `jku`, `x5u`, `jwk` and `x5c` headers point to, or contain, a key of the sender's choosing (CVE-2018-0114 was an embedded `jwk` that the library trusted), and following a `jku` or `x5u` URL is also a server-side request forgery. Take keys only from the configured issuer's JWKS, and treat `kid` as untrusted input that selects a key in that set and nothing else.
  - *Missing audience check.* A token issued for one API is replayed against another that trusts the same issuer. `aud` stops it.
  - *Issuer mix-up.* An API that trusts several issuers or tenants and searches all of their key sets for the `kid` will accept a token whose `iss` names one issuer and whose signature comes from another. Choose the key set by the validated issuer, never from a union.
  - *ID token as access token.* Both are JWTs from the same issuer (see [OpenID Connect](../openid-connect/)). `typ: at+jwt` tells them apart when the issuer sets it; otherwise the audience does, since an ID token's `aud` is the client's ID, together with claims an ID token lacks, such as `scope`.
- **RFC 9068 is a profile, not a given.** Many issuers predate it or don't follow it. Microsoft Entra ID access tokens carry `typ: JWT` and put scopes in `scp`; Auth0 issues its own token format by default and RFC 9068 tokens when you choose that profile for an API. Read your issuer's documentation and validate what it actually issues.
- **JWKS caching.** Cache per issuer and look keys up by `kid`. Refresh in the background, respect the endpoint's HTTP cache headers, and keep serving from the cache when the issuer is briefly unreachable. Limit the refetches that an unknown `kid` can trigger: jose's `createRemoteJWKSet` waits 30 seconds between them and treats the set as fresh for 10 minutes by default; Microsoft's guidance for Entra ID is to keep keys for 24 hours, refresh every hour, and refresh on an unknown `kid` at most once every five minutes.
- **If you run the issuer,** publish a new key before you sign with it, and keep the old one published for at least the longest token lifetime plus the longest verifier cache. Amazon API Gateway, for example, caches keys for up to two hours.
- **Clock skew.** Keep clocks synchronized and allow a small leeway. RFC 7519 says no more than a few minutes; Spring Security defaults to 60 seconds.
- **Where to validate.** At the [API gateway](../api-gateway/), bad tokens are rejected before they reach a service and the configuration lives in one place. Gateways and proxies do this out of the box: Amazon API Gateway JWT authorizers, Azure API Management's `validate-jwt` policy, Envoy's JWT authentication filter and Istio's `RequestAuthentication`, for example. In each service, nothing depends on network position, and each service checks its own audience and scopes. Doing both is common: the gateway turns away the obviously bad, and services validate again because they can be reached from inside too. If only the gateway validates and passes the identity on in headers, the services must not be reachable any other way.
- **Calling the next API.** A token whose `aud` is this API should not be forwarded to another one: that API's audience check will, and should, reject it. Exchange it for a token addressed to the downstream API (OAuth 2.0 Token Exchange, RFC 8693), or call with the service's own token from the client credentials grant.
- **Algorithms.** RS256 is the one RFC 9068 requires every implementation to support, and a common default. ES256 signatures are a quarter of the size (64 bytes against 256 for a 2048-bit RSA key), and OWASP's cheat sheet lists ECDSA, RSASSA-PSS and EdDSA as recommended and RS256's RSASSA-PKCS1-v1_5 as not recommended. Whatever the issuer uses, the allowlist has to match it.
- **The standards are moving.** RFC 8725 is still the published JWT BCP. Its replacement, draft-ietf-oauth-rfc8725bis, has been approved and is waiting in the RFC Editor's queue (October 2026). It keeps the rules above and adds a few: reject anything that is not in compact form, limit PBES2 iteration counts and decompressed JWE sizes, and treat `kid`, `jku` and `x5u` as attacker-controlled.
- **Errors and logs.** Send the RFC 6750 challenge, so the client knows whether to get a new token (401) or one with more scope (403), and never log whole tokens: `jti`, `sub` and `kid` are enough to trace a request.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- OAuth 2.0 Client Credentials *(planned)* — Machine-to-machine access tokens, with no user involved.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.
- Token Exchange (On-Behalf-Of) *(planned)* — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- Mutual TLS (mTLS) *(planned)* — Client and server both present certificates, so every connection is authenticated both ways.

## References

- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 7515 — JSON Web Signature (JWS)](https://www.rfc-editor.org/rfc/rfc7515)
- [RFC 7517 — JSON Web Key (JWK)](https://www.rfc-editor.org/rfc/rfc7517)
- [RFC 8725 — JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [IETF OAuth WG — JSON Web Token Best Current Practices (draft-ietf-oauth-rfc8725bis, to replace RFC 8725)](https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc8725bis/)
- [RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414)
- [OpenID Connect Discovery 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OpenID Connect Core 1.0 incorporating errata set 2 — §10.1.1 Rotation of Asymmetric Signing Keys](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys)
- [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [RFC 7662 — OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705)
- [OWASP Cheat Sheet Series — JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
