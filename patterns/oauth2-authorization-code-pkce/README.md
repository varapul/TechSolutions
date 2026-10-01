<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# OAuth 2.0 Authorization Code + PKCE

> The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.

<p align="center"><img src="diagram.svg" alt="Animated diagram: OAuth 2.0 Authorization Code + PKCE" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/oauth2-authorization-code-pkce.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Authorization request** | The App generates a one-time random **code_verifier** (43–128 characters) and keeps it to itself. It redirects the browser to the authorization endpoint with `response_type=code`, `client_id`, `redirect_uri`, `scope`, an unguessable `state`, and `code_challenge` = BASE64URL(SHA-256(code_verifier)) with `code_challenge_method=S256`. The authorization server stores the challenge with the request. |
| **2 · Sign in & consent** | The authorization server authenticates the user (password, passkey, MFA, federated login) and asks for consent to the requested scopes; the App never sees the credentials. It then redirects the browser to `redirect_uri?code=…&state=…`, and the App checks that `state` matches the value it sent. This is the **front channel**: the code travels in a URL, where browser history, logs or a malicious app claiming the same redirect URI can see it, so holding the code alone must not be enough to get tokens. |
| **3 · Code exchange** | Over the **back channel** (a direct HTTPS request, not a browser redirect) the App posts the code together with its `code_verifier` to the token endpoint. The server checks that the SHA-256 hash of the verifier matches the stored `code_challenge` (and that the code is unused, unexpired and issued to this `client_id` and `redirect_uri`), then returns an **access token**, usually a refresh token, and an ID token with OpenID Connect. A stolen code is useless without the verifier: the server answers `invalid_grant`. |
| **4 · Call the API** | The App sends `Authorization: Bearer <access_token>`. The API validates the JWT locally: the signature against the authorization server's public keys (JWKS, cached and re-fetched when an unknown `kid` appears), then `iss`, `aud`, `exp` and the required scope, and returns 200 OK. When the access token expires, the App uses its refresh token instead of sending the user through the flow again. |
<!-- END GENERATED: header -->

## The problem

An app needs to call an API on a user's behalf. It must never handle the user's password, and the tokens it receives must not leak on the way. The older answers each had a hole: the resource owner password grant hands the credentials to the app, and the implicit grant returns the access token in the redirect URL's fragment, where it lands in browser history and any script on the page can read it. The plain authorization code grant is better, because only a short-lived, single-use **code** travels through the browser and the tokens come back over a direct request. But public clients (single-page apps, mobile and desktop apps) can't keep a client secret, so anyone who intercepts the code could redeem it as if they were the app: a malicious app registered for the same custom URL scheme, a `Referer` header, a log file.

## How it works

PKCE (Proof Key for Code Exchange, RFC 7636, pronounced "pixy") binds the code to the app instance that started the flow:

1. **Authorization request (front channel).** The app creates a fresh, high-entropy `code_verifier` and keeps it. It sends only `code_challenge = BASE64URL(SHA-256(code_verifier))` and `code_challenge_method=S256`, along with the usual `response_type=code`, `client_id`, `redirect_uri`, `scope` and `state`.
2. **Sign-in and consent.** The authorization server authenticates the user and gets consent, then redirects the browser back to the app with a `code` (bound to the stored challenge) and the same `state`.
3. **Code exchange (back channel).** The app sends the code and the `code_verifier` to the token endpoint in a direct HTTPS request. The server hashes the verifier and compares it with the stored challenge. Only the instance that generated the verifier can pass, so an intercepted code is worthless.
4. **Use the token.** The app sends the access token as a bearer token; the API validates it and serves the request. The refresh token gets new access tokens later without involving the user.

The hash only works one way. Seeing the challenge in step 1 doesn't reveal the verifier, and seeing the code in step 2 isn't enough to redeem it.

## When to use it

- Any application that signs users in and calls APIs on their behalf: single-page apps, native mobile and desktop apps, and server-side web apps.
- It's the default for new work. The OAuth 2.0 Security Best Current Practice (RFC 9700) requires PKCE for public clients and recommends it for confidential ones, and the OAuth 2.1 draft builds it into the authorization code grant.
- With OpenID Connect the same flow also signs the user in: add `openid` to the scope and the token response includes an ID token.
- Not for service-to-service calls with no user (use client credentials) or for devices without a usable browser, such as TVs and CLIs (use the device authorization grant).

## Trade-offs

- **More moving parts than the implicit flow.** Two redirects, a token request, token storage and refresh. Use your identity provider's SDK or a certified library rather than hand-rolling it.
- **PKCE protects the code, not the tokens.** A bearer token works for whoever holds it. Keep access tokens short-lived and narrowly scoped, and consider sender-constrained tokens (DPoP, RFC 9449, or mutual TLS, RFC 8705) for high-value APIs.
- **Browsers are the hardest place to keep tokens.** Any XSS in a single-page app can act as the app and use its tokens. The IETF guidance for browser-based apps prefers a backend-for-frontend that runs this flow as a confidential client and gives the browser only an HttpOnly session cookie.
- **Refresh tokens are long-lived secrets.** For public clients, RFC 9700 requires them to be sender-constrained or rotated on every use.
- **Self-contained JWTs can't be revoked instantly.** The API trusts a JWT until it expires. To cut access off sooner, keep lifetimes short or use token introspection (RFC 7662).

## Implementation notes

- **Verifier:** 32 bytes from a cryptographically secure random generator, base64url-encoded without padding (43 characters). Use one per authorization request, keep it next to `state`, and delete both after the exchange. Always use `S256`: the `plain` method sends the verifier itself and only exists for clients that can't compute SHA-256.
- **`state` and `nonce`:** send an unguessable `state` and check it on the callback. PKCE (when the server enforces it) and the OpenID Connect `nonce` also stop CSRF, but `state` is cheap and carries app context across the redirect.
- **Redirect URIs:** register them exactly; the server must compare them by exact string match, except that it must accept any port on a native app's loopback redirect URI (RFC 9700, RFC 8252 §7.3). Native apps open the system browser, never an embedded web view, and receive the redirect on a claimed HTTPS link, a private-use URI scheme or a loopback address (RFC 8252).
- **Confidential clients** (a web backend) also authenticate at the token endpoint, preferably with `private_key_jwt` or mutual TLS rather than a shared secret. PKCE still applies on top.
- **Authorization server:** make codes single-use and short-lived (RFC 6749 recommends at most 10 minutes), bind them to `client_id`, `redirect_uri` and the challenge, and reject a token request that carries a `code_verifier` when the authorization request had no challenge (a PKCE downgrade).
- **API:** validate JWT access tokens locally (RFC 9068): the signature with keys from the issuer's JWKS (cached, and refreshed when an unknown `kid` shows up), then `iss`, `aud`, `exp` and the required scope. Send opaque tokens to the introspection endpoint instead.
- **Products:** every mainstream identity provider supports this flow, for example Microsoft Entra ID, Amazon Cognito, Google Identity, Okta, Auth0, Keycloak and Ping Identity. Client libraries include MSAL, AppAuth (iOS and Android), oidc-client-ts, openid-client (Node.js) and Spring Security.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- OAuth 2.0 Client Credentials *(planned)* — Machine-to-machine access tokens, with no user involved.
- Device Authorization Grant *(planned)* — Sign in on a TV or CLI by approving a short code on your phone.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- Federated Identity *(planned)* — Let an external identity provider authenticate users; the application trusts its tokens.

## References

- [RFC 6749 — The OAuth 2.0 Authorization Framework (§4.1 Authorization Code Grant)](https://www.rfc-editor.org/rfc/rfc6749#section-4.1)
- [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients (PKCE)](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252)
- [RFC 10017 — OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017)
- [RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
