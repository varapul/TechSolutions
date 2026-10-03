<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# OpenID Connect (OIDC)

> An ID token on top of OAuth 2.0 tells the app who signed in.

<p align="center"><img src="diagram.svg" alt="Animated diagram: OpenID Connect (OIDC)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/openid-connect.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Sign in to Shop** | Ana clicks *Sign in*. Shop redirects her browser to the provider's authorization endpoint with `response_type=code`, `scope=openid profile email` (plus `orders:read` for its API) and a fresh, unguessable `nonce` that it remembers. The provider shows its login form, checks her password and starts its own **SSO session**, kept in a cookie on the provider's domain, then redirects her back to Shop with an authorization code. |
| **2 · Validate the ID token** | Shop swaps the code for tokens over the back channel and inspects the **ID token**: a JWT signed by the provider that says who signed in, for which app and until when. Shop verifies the signature with the JWKS key whose `kid` matches (it found the JWKS URL in `/.well-known/openid-configuration`), then checks `iss` against the discovered issuer, `aud` against its own `client_id`, `exp`, and that `nonce` is the value it sent. It then starts its own session keyed on `sub` (together with `iss`), never on `email`, which can change. |
| **3 · Single sign-on** | Later Ana opens Support, which redirects her to the same provider with its own `client_id` and a new `nonce`. Her browser sends the provider's session cookie along, so the provider skips the login form and returns a code at once (it would still ask for consent if Support needed it, and re-authenticate for `prompt=login` or an expired `max_age`). Support validates **its own ID token**, whose `aud` is `support`, and starts a separate session; with public subject identifiers its `sub` matches Shop's, while a provider using pairwise identifiers gives each app a different one. |
| **4 · ID token vs access token** | The two tokens Shop holds have different jobs. The ID token is addressed to Shop (`aud=shop`) and only tells Shop who signed in, so it stays there; calls to the Orders API carry the **access token**, issued for the API (`aud=orders-api`, scope `orders:read`). An API that checks `aud` rejects an ID token, so never use one as a bearer token. |
<!-- END GENERATED: header -->

## The problem

OAuth 2.0 lets an app call an API on a user's behalf, but it never tells the app who the user is. An access token is addressed to an API, and holding one only proves that someone authorized something. Apps that "log in with OAuth" by calling a provider's profile API end up with a different integration for every provider, and an attacker can sign in to them as someone else by replaying that person's access token from a different app (RFC 6819 calls this *token substitution*). Meanwhile users with a dozen apps want to sign in once, and every one of those apps needs a standard way to learn who signed in, when and how.

## How it works

OAuth 2.0 answers *what may this app call?*; OpenID Connect adds *who just signed in to this app?* It is a thin identity layer on top of OAuth 2.0: the authorization code flow runs as usual (see [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) for the protocol detail), with a few additions:

- **The `openid` scope** turns an authorization request into an *authentication* request. The `profile`, `email`, `address` and `phone` scopes ask for standard sets of claims about the user.
- **The ID token** is a JWT signed by the OpenID Provider (OP) and addressed to the client, which OIDC calls the relying party (RP). It says who issued it (`iss`), who signed in (`sub`), which client it is for (`aud`), when it was issued and when it expires (`iat`, `exp`), and echoes the `nonce` the client sent. Optional claims say when and how the user authenticated (`auth_time`, `acr`, `amr`).
- **The UserInfo endpoint** is an OAuth-protected API on the provider that returns claims about the user to whoever presents the access token.
- **Discovery** publishes a JSON document at `{issuer}/.well-known/openid-configuration` that lists the provider's endpoints, the features it supports and its `jwks_uri`, where it serves its public signing keys as a JWK Set (JWKS).
- **Session and logout** specifications cover what happens after sign-in (see below).

**Validating an ID token.** OpenID Connect Core §3.1.3.7 lists the checks. Your library runs them, but you should know what they are:

1. **Signature:** verify it with the provider's key whose `kid` matches in the JWKS, and accept only the algorithms you expect (RS256 unless you registered another; refuse `none`, see RFC 8725). In the code flow the ID token arrives straight from the token endpoint over TLS, so Core allows relying on TLS instead. Libraries usually verify the signature anyway, and you must whenever an ID token reaches you any other way.
2. **`iss`** exactly equals the issuer from the discovery document.
3. **`aud`** contains your `client_id`. Reject tokens that also name audiences you don't trust.
4. **`exp`** is in the future, with a small leeway for clock skew (a few minutes at most). `iat` lets you reject tokens that were issued too long ago.
5. **`nonce`** equals the value you sent with this sign-in, and is accepted only once.
6. If you requested them, check `acr` and `auth_time` (for example after sending `max_age`).

**`sub` is the user key.** Together, `iss` and `sub` are the only stable, unique identifier for a user: `sub` is never reassigned within an issuer (Core §5.7). Email addresses, phone numbers, usernames and names can change or be reused, and Core says they must not be used as unique identifiers. With *public* identifiers every app gets the same `sub`; with *pairwise* identifiers each app gets its own, so apps can't correlate a user without permission. Microsoft Entra ID's `sub` is pairwise per application, for example, and it offers `oid` as a tenant-wide ID.

**Single sign-on.** Once an app has validated the ID token, it runs its own session; the ID token's `exp` has nothing to do with how long the user stays signed in (Core §2). The provider keeps a session of its own in a cookie on its domain. That cookie is what makes SSO work: the next app's authentication request carries it, and the provider answers with a code without showing a login form. An app can force a fresh login with `prompt=login` or `max_age`, or check for a session without any UI with `prompt=none`, which returns an error (typically `login_required`) when there isn't one.

## When to use it

- Signing users in to web, mobile and single-page apps through a central or external identity provider: a workforce directory, a customer identity platform or a social login.
- Single sign-on across many apps, including federation, where your provider brokers sign-in to the identity providers of partner organizations.
- Anywhere you would otherwise store passwords yourself.
- For new apps, especially native and single-page ones, OIDC is the usual choice. SAML 2.0 remains common in enterprise SaaS, and identity providers commonly speak both.
- Not for machine-to-machine calls with no user (use OAuth 2.0 client credentials), and not for authorizing API calls: that is the access token's job.

## Trade-offs

- **Logout is the hard part.** There is one session per app plus one at the provider, and ending one doesn't end the others (see the implementation notes).
- **The provider is a critical dependency.** If it is down, nobody can sign in, although existing app sessions keep working.
- **Claims are a snapshot.** The ID token describes the user at sign-in. A changed role or a disabled account only shows up at the next sign-in, unless apps call UserInfo again, keep sessions short and re-authenticate silently, or receive back-channel logout.
- **Privacy versus correlation.** Public `sub` values let your apps join their data; pairwise values protect users but need a separate shared ID when you do want to correlate.
- **Tokens in the browser.** A single-page app that keeps tokens in JavaScript exposes them to any XSS. A backend-for-frontend keeps the tokens on the server and gives the browser only a session cookie.

## Implementation notes

- **Use a maintained library** rather than parsing tokens yourself (the OpenID Foundation lists [certified implementations](https://openid.net/developers/certified-openid-connect-implementations/)). Widely used ones include openid-client (Node.js), MSAL, AppAuth (iOS and Android), oidc-client-ts and Spring Security. Every mainstream identity provider is an OP: Microsoft Entra ID, Okta, Auth0, Google, Amazon Cognito, Keycloak and Ping Identity, among others.
- **Which flow:** the authorization code flow with PKCE, for every kind of client. The OAuth 2.0 Security BCP (RFC 9700) says clients should not use response types that return access tokens from the authorization endpoint, such as the implicit `id_token token`, and should use `code` instead (or the hybrid `code id_token`). For single-page apps, RFC 10017 strongly recommends a backend-for-frontend for business and sensitive applications and for apps that handle personal data.
- **`nonce`, `state` and PKCE:** generate a fresh random `nonce` for each sign-in and bind it to the browser session; Core suggests keeping a random value in an HttpOnly cookie and sending its hash as the `nonce`. RFC 9700 requires PKCE for public clients and recommends it for confidential ones, which may use the `nonce` instead with extra precautions. Send `state` as well.
- **Discovery and key rotation:** configure only the issuer URL and read everything else from discovery. The document's `issuer` must be identical to that URL and to the `iss` in every ID token. Cache the JWKS (respecting its HTTP cache headers), and when a token arrives with an unknown `kid`, fetch the JWKS again before rejecting it, with a rate limit. Providers rotate keys by publishing the new key, signing with it under a new `kid`, and keeping recently retired keys for a while (Core §10.1.1).
- **Two tokens, two audiences:** the ID token is for the client and the access token is for APIs. Never send an ID token as a bearer token, and don't make the client depend on what is inside an access token: its format is a matter between the provider and the API. APIs that accept JWT access tokens should check `aud` and, under RFC 9068, the `typ` header (`at+jwt`), and an ID token normally fails both.
- **UserInfo:** call it with the access token when you need claims that aren't in the ID token, or fresher values, and check that its `sub` equals the ID token's. In the code flow, Core returns the `profile` and `email` claims from UserInfo; many providers also copy them into the ID token, as Google does with `email` when you request the `email` scope.
- **Logout options:**
  - *Local logout* only ends the app's session. The provider's session survives, so the next *Sign in* goes through silently.
  - *RP-Initiated Logout* redirects the browser to the provider's `end_session_endpoint` with an `id_token_hint` and a registered `post_logout_redirect_uri`, so the provider can end its session too. Without the hint, the provider must ask the user to confirm.
  - *Back-Channel Logout* has the provider POST a signed **logout token** to each app's `backchannel_logout_uri`: a JWT with an `events` claim and the `sid` or `sub` to end, and no `nonce`. It is server to server and doesn't need the browser, but every app must be able to find and end sessions by `sid` or `sub`.
  - *Front-Channel Logout* has the provider load each app's `frontchannel_logout_uri` in hidden iframes. Browsers that block or partition third-party cookies often keep the app from seeing its own session inside the iframe (Safari blocks them; Firefox partitions them by default), and the spec itself warns about this.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- SAML 2.0 Single Sign-On *(planned)* — Enterprise SSO: the identity provider posts a signed assertion to the app through the browser.
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.

## References

- [OpenID Connect Core 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OpenID Connect RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)
- [OpenID Connect Back-Channel Logout 1.0 incorporating errata set 1](https://openid.net/specs/openid-connect-backchannel-1_0.html)
- [OpenID Connect Front-Channel Logout 1.0](https://openid.net/specs/openid-connect-frontchannel-1_0.html)
- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [oauth.net — ID Tokens vs Access Tokens](https://oauth.net/id-tokens-vs-access-tokens/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
