<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Refresh Token Rotation

> Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Refresh Token Rotation" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/refresh-token-rotation.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Short-lived access token** | After sign-in the app holds two tokens: an **access token** that lives for minutes (10 here) and a **refresh token**, RT1, the first of a new **token family** on the authorization server. API calls carry only the access token; the refresh token is never sent to the API. When the access token has expired, the API answers `401` with `error="invalid_token"`, and that is the app's cue to refresh. |
| **2 · Refresh and rotate** | The app posts `grant_type=refresh_token` with RT1 to the token endpoint. The server finds RT1 **active**, marks it **used**, and returns a new access token together with a *new* refresh token, RT2, in the same family: every refresh token works exactly once. The app replaces both tokens and calls the API again. |
| **3 · Reuse is detected** | An attacker who copied RT1 earlier now replays it. The server sees a refresh token that was already used: the sign that two parties hold tokens from this family, and it cannot tell which of them is the thief. So it revokes the **whole family**, RT2 included, and answers `invalid_grant`. |
| **4 · Sign in again** | When its access token expires, the app sends RT2 and gets `invalid_grant` as well, so it drops its tokens and sends the user through sign-in again, which starts a new family with a new RT1. The theft has cost the user one extra sign-in. The damage is bounded: the thief has no working refresh token and holds, at most, an access token that expires within minutes. |
<!-- END GENERATED: header -->

## The problem

An API that validates tokens locally cannot take an access token back before it expires, so access tokens should live for minutes. Nobody wants to sign in every ten minutes, though, and the older way for a browser app to renew silently, a hidden iframe that relied on the authorization server's session cookie, fails wherever the browser treats that cookie as third-party and blocks it. The **refresh token** fills the gap: a longer-lived credential that the app exchanges at the token endpoint for a fresh access token, with no user involved.

That moves the risk rather than removing it. A refresh token stands for the whole grant: whoever holds it can mint access tokens for everything the user approved, again and again, for days or months. A confidential client has to authenticate when it refreshes, so a stolen refresh token is useless without the client's own credentials. A **public client** (a single-page app, a mobile or desktop app) has nothing to authenticate with. Its refresh token is a bearer credential: a copy works exactly as well as the original, and the server never learns that there are two holders.

## How it works

Rotation makes every refresh token **single-use**, and treats the second appearance of a used token as the alarm.

1. **Rotate on every refresh.** The request is the ordinary one from RFC 6749 §6: a POST to the token endpoint with `grant_type=refresh_token` and the refresh token. The response carries a new access token **and a new refresh token**, and the token that was just presented is retired. The client's part is already in RFC 6749: when a response includes a new refresh token, discard the old one and keep the new one.
2. **Remember the family.** The server keeps the records of retired tokens and how they relate. All refresh tokens that descend from one sign-in form a chain: Auth0's documentation calls it a *token family*, and RFC 9700 speaks of the grant a token belongs to. At any moment one token in the family is **active** and the earlier ones are **used**.
3. **Treat reuse as theft.** A used token that shows up again is the sign that two parties hold tokens from this family. The server cannot tell whether the request came from the thief or from the legitimate app, so it does the only safe thing: it revokes the family, the active token included, and answers `invalid_grant` (RFC 6749 §5.2, HTTP 400). The app finds out at its next refresh and sends the user through sign-in again ([Authorization Code + PKCE](../oauth2-authorization-code-pkce/)), which starts a new family.

**Either order of events trips the alarm.** In the diagram the app refreshes first, and the attacker's replay of RT1 is what gets noticed. If the attacker refreshes first, it receives a working pair, AT2 and RT2, and the app is now the one holding a used token. The app's next refresh, with RT1, is the reuse: the family is revoked, the attacker's RT2 with it, and the user signs in again. In that order the thief did get in, for as long as its access token lasts, which is why the access token's lifetime is the real bound on the damage.

**Where the rule comes from.** RFC 6749 §10.4 (2012) offered rotation as an example of how to detect refresh token abuse when the client can't be authenticated, and RFC 6819 §5.2.2.3 added what to do on reuse: revoke the valid token and the authorization behind it. RFC 9700, the OAuth security BCP (January 2025), made it a requirement: §2.2.2 says refresh tokens for public clients must be sender-constrained or use rotation, and §4.14.2 defines both methods. RFC 10017, the BCP for browser-based applications (August 2026), repeats the requirement in §6.3.2.3 and adds lifetime rules. OAuth 2.1 folds the same rule into the core framework (§4.3.1 of draft-ietf-oauth-v2-1-16, September 2026), but it is still a working-group Internet-Draft, not an RFC.

## When to use it

- **Public clients that receive refresh tokens:** single-page apps, mobile apps and desktop apps. For them this isn't optional: RFC 9700 §2.2.2 requires either rotation or sender-constrained refresh tokens.
- **Browser apps that hold their own tokens.** With third-party cookies blocked, a rotating refresh token is what keeps a single-page app signed in. RFC 10017 does not recommend that architecture for business applications, sensitive applications or applications that handle personal data: for those it strongly recommends a [backend for frontend](../backends-for-frontends/), which keeps the tokens on the server.
- **Confidential clients, as defence in depth.** A web backend authenticates at the token endpoint, so a stolen refresh token is useless without the client's credentials and the standards don't require rotation. It is still worth turning on: if the credentials leak as well, reuse detection is what notices.
- **Not where there is no refresh token.** The client credentials grant has none (RFC 6749 §4.4.3 says one should not be issued): the service simply asks for a new access token.
- **Not as the only defence for a high-value app.** Rotation detects one kind of theft after the fact. It doesn't keep tokens from being stolen.

## Trade-offs

- **Detection needs both parties to show up.** The alarm rings only when the *other* holder presents its token. A thief who makes sure the app never refreshes again (by wiping the app's tokens, or by waiting until the user closes the app or goes offline) can keep rotating the stolen chain unnoticed; RFC 10017 §5.1.2 describes exactly this. Idle and absolute lifetimes are what end such a chain.
- **It doesn't stop code running inside the app.** Script injected into a single-page app can read each new token as it arrives, or ignore the app's tokens and silently run an authorization flow of its own to get a separate family (RFC 10017 §5.1.3). Rotation and short lifetimes don't help against that; keeping tokens out of the browser does.
- **Access tokens outlive the family.** Revoking the family stops new access tokens from being issued. One that was already issued keeps working until it expires wherever the API validates it locally (see [JWT Validation](../jwt-validation/)). "Minutes" is a decision you have to make: vendor defaults are often longer, for example a random 60 to 90 minutes in Microsoft Entra ID and 24 hours for an API in Auth0.
- **False alarms sign real users out.** Two browser tabs that refresh at the same moment, a retry after a timeout, or a response that never reached the device all make an honest client present a used token. Without care, reuse detection turns a flaky network into a sign-out.
- **Refresh becomes a write.** Every refresh changes state that all nodes of the authorization server must agree on, and marking a token used has to be atomic, or two simultaneous requests could both succeed. RFC 6819 already warned that rotation can cause problems in clustered deployments.
- **The honest user pays for the uncertainty.** Because the server can't tell the thief from the app, the user is signed out too. That is the design working, and the app has to handle it gracefully.

## Implementation notes

- **What the server stores.** One record per refresh token: a **family ID** (or the ID of the grant), a **hash** of the token, its **status** (active, used or revoked), the client, user and scope it was issued for, and its expiry times. Store the hash rather than the token, so that a leaked table can't be replayed (RFC 6819 §5.1.4.1.3). A plain SHA-256 will do: the salting and slow hashing that passwords need are there to stop dictionary attacks, and a refresh token is a long random string (RFC 6749 §10.10 requires the chance of guessing one to be at most 2⁻¹²⁸). Keep the records of used tokens until the family expires, because they are what makes reuse detectable. RFC 9700 also notes that the grant can be encoded in the refresh token itself, protected by a signature, so the server can find the family from any token it ever issued.
- **Make the swap atomic.** Look the token up by its hash and flip it from active to used in one conditional update or transaction, then issue the next one. Two requests that carry the same token must never both find it active.
- **On reuse,** revoke every token in the family and the grant behind it (Auth0 does both, and the OAuth 2.1 draft specifies both), answer `invalid_grant`, and record a security event. Okta, for example, writes a reuse event to its System Log (`app.oauth2.as.token.detect_reuse` for a custom authorization server, `app.oauth2.token.detect_reuse` for the org authorization server).
- **Two lifetimes.** An **absolute lifetime** caps the whole family: every successor inherits the first token's expiry, so rotating never extends it. An **idle lifetime** expires a token that hasn't been used for a while. RFC 9700 §4.14.2 says refresh tokens should expire after inactivity. RFC 10017 §6.3.2.3 requires a browser app's refresh tokens to have a maximum lifetime or an idle timeout, and forbids a rotated token from outliving the first one when that had a fixed expiry; its example pairs a 10-minute access token with an 8-hour refresh token, the values used in the diagram. The same section says the refresh token's lifetime should be tied to the user's session at the authorization server, so that signing out there ends the family too.
- **Client: one refresh at a time.** Funnel refreshes through a single in-flight request per app instance. Across browser tabs, take a lock (the Web Locks API) or let one tab refresh and share the result. Save the new refresh token before using the new access token. Refresh when the API answers `401` with `error="invalid_token"` (RFC 6750 §3.1), or a little before `expires_in` runs out. Treat `invalid_grant` as "signed out": clear the tokens and start sign-in, and don't retry. No standard field tells a client when its refresh token will expire, so it has to be ready for that answer at any time.
- **Grace periods for honest retries.** Vendors let the previous token work a little longer, so that a retry is not taken for theft. Okta's grace period defaults to 30 seconds and can be set from 0 to 60. Auth0's rotation overlap period is off by default and, when set, accepts only the immediately preceding token. Amazon Cognito allows up to 60 seconds. The trade-off is plain: inside that window a replayed token is answered with fresh tokens instead of an alarm, so a thief who is quick enough goes undetected. Fix the races in the client first, then keep the window as short as your network allows.
- **Sender-constrained refresh tokens are the stronger alternative.** RFC 9700 accepts either measure, and binding a token to a key beats detecting its misuse afterwards: a copy is useless without the private key, nobody has to be signed out, and there is no race to manage. With **DPoP** (RFC 9449 §5) a public client sends a proof signed with its own key pair on every token request, and the server must bind the refresh token to that key; in a browser the key can be generated as non-extractable with the Web Crypto API. With **mutual TLS** (RFC 8705 §4) the server should bind a public client's refresh token to its certificate. Two limits: script running inside the app can still use the key while the page is open (RFC 9449 §11.4), and your authorization server has to support it. The two measures also combine: a key-bound refresh token can rotate as well.
- **Confidential clients.** RFC 6749 §6 requires them to authenticate on every refresh, and RFC 9449 §5 notes that this already sender-constrains their refresh tokens, more flexibly than a key binding would. Rotation is optional for them.
- **Where the tokens live.** A browser has no storage that injected script can't reach: `localStorage`, `sessionStorage`, IndexedDB and in-memory variables all give way to code running in the page (RFC 10017 §8). The architecture that RFC 10017 ranks as the most secure is the [backend for frontend](../backends-for-frontends/): it is a confidential client, it keeps the access and refresh tokens on the server, and the browser holds only an `HttpOnly` session cookie. A native app should keep its refresh token in the platform's secure storage (the Keychain on iOS, the Keystore on Android).
- **Asking for a refresh token.** With OpenID Connect the app requests one by adding the `offline_access` scope (Core §11); Auth0 and Okta require it. Under RFC 9700 §4.14.2 the authorization server decides, from a risk assessment, whether a given client gets refresh tokens at all.
- **Sign-out.** Post the refresh token to the revocation endpoint (RFC 7009) and drop the local copies. An authorization server that implements RFC 7009 must support revoking refresh tokens, should also invalidate the access tokens issued under the same grant if it can revoke access tokens at all, and answers 200 even when the token was already invalid. On the server side, RFC 9700 §4.14.2 allows refresh tokens to be revoked automatically when the user changes a password or signs out at the authorization server.
- **Products, as documented in October 2026:**
  - *Auth0:* rotation is a per-application setting. Reuse detection is automatic and revokes the whole family together with the grant. The lifetime (30 days by default with rotation, up to one year) doesn't grow when tokens rotate.
  - *Okta:* rotation is the default for single-page apps; web and mobile apps get a persistent refresh token unless you select "Rotate token after every use". On reuse it invalidates the newest refresh token and every access token issued since the user authenticated. A rotated token keeps the first token's expiry.
  - *Microsoft Entra ID:* every refresh returns a new refresh token, but the old one is not revoked when it is used (the documentation tells the app to delete it), so the tokens are not single-use. What limits a stolen token there is its lifetime: 24 hours for a single-page app, carried over to each new token, and 90 days in most other scenarios.
  - *Amazon Cognito:* rotation is optional per app client (`RefreshTokenRotation`), with a retry grace period of 0 to 60 seconds, and it can't be combined with the `REFRESH_TOKEN_AUTH` flow. A rotated token keeps the original expiry (30 days by default, configurable from 60 minutes to 10 years). The documentation describes the old token being invalidated, not the whole chain being revoked when one is replayed.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [Backends for Frontends (BFF)](../backends-for-frontends/) — A dedicated backend per client type, shaped for exactly what that UI needs.
- Token Exchange (On-Behalf-Of) *(planned)* — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- OAuth 2.0 Client Credentials *(planned)* — Machine-to-machine access tokens, with no user involved.

## References

- [RFC 6749 — The OAuth 2.0 Authorization Framework (§6 Refreshing an Access Token; also §1.5 and §10.4)](https://www.rfc-editor.org/rfc/rfc6749#section-6)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security (§4.14 Refresh Token Protection)](https://www.rfc-editor.org/rfc/rfc9700#section-4.14)
- [RFC 10017 — OAuth 2.0 for Browser-Based Applications (§6.3.2.3 Refresh Tokens)](https://www.rfc-editor.org/rfc/rfc10017#section-6.3.2.3)
- [IETF OAuth WG — The OAuth 2.1 Authorization Framework (draft-ietf-oauth-v2-1, Internet-Draft)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)
- [RFC 6819 — OAuth 2.0 Threat Model and Security Considerations (§5.2.2.3 Refresh Token Rotation)](https://www.rfc-editor.org/rfc/rfc6819#section-5.2.2.3)
- [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage (§3.1 Error Codes)](https://www.rfc-editor.org/rfc/rfc6750#section-3.1)
- [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705)
- [RFC 7009 — OAuth 2.0 Token Revocation](https://www.rfc-editor.org/rfc/rfc7009)
- [OpenID Connect Core 1.0 incorporating errata set 2 — §11 Offline Access](https://openid.net/specs/openid-connect-core-1_0.html#OfflineAccess)
- [Auth0 Docs — Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [Okta Developer — Refresh access tokens and rotate refresh tokens](https://developer.okta.com/docs/guides/refresh-tokens/main/)
- [Microsoft Learn — Refresh tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)
- [Amazon Cognito Developer Guide — Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
