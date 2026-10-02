<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Token Exchange (On-Behalf-Of)

> Swap an incoming user token for a narrowly scoped one before calling a downstream API.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Token Exchange (On-Behalf-Of)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/token-exchange.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Don't forward the token** | Ana's Shop app calls the Orders API with an access token made for it: `aud: orders-api`, `sub: ana`, `scope: orders:write`. To check stock, the Orders API passes that same token on to the Inventory API, which reads `aud`, finds another API's name and answers **401**. That refusal is the defence working: an API that accepted tokens made for other APIs would let any of them, lifted from a log or from a compromised service, be replayed against it. |
| **2 · Exchange it** | Instead, the Orders API goes to the authorization server's token endpoint as itself, authenticating as a client. It sends `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` with Ana's token as `subject_token` (who the call is for), its own access token as `actor_token` (who will be acting), each with its `…_token_type`, and the target it wants: `audience=inventory-api` (or a `resource` URI) and `scope=inventory:read`. The server validates both tokens and consults its policy: may the Orders API act for users at the Inventory API, with that scope? |
| **3 · A narrow token for one hop** | The server answers with a new access token: `aud: inventory-api`, `sub` still `ana`, `scope` limited to `inventory:read`, a five-minute lifetime and `act: {"sub": "orders-api"}`, which records who is acting for her. The Orders API calls the Inventory API with it. The Inventory API validates it locally, like any other access token, and sees both parties: the user in `sub` and the acting service in `act`. |
| **4 · Every hop, its own token** | The Inventory API needs a price, so it exchanges the token it was called with: the result has `aud: pricing-api`, only the scope that hop needs, and a nested `act` chain with `inventory-api` as the current actor and `orders-api` inside it as the earlier one. No token is valid at more than one API. This is **delegation**: `act` keeps the acting service visible. With **impersonation** the server issues a token without `act`, and downstream the call looks as if Ana had made it herself. When no user is involved at all there is nothing to exchange: use the client credentials grant. |
<!-- END GENERATED: header -->

## The problem

A user's request rarely stops at the first API. The Orders API that takes Ana's order asks the Inventory API about stock, the Inventory API asks the Pricing API for a price, and each of them has to decide what this call may do and for whom. The access token that arrived with the request already says who the user is, so the tempting move is to pass it along. That goes wrong in one of two ways.

**If the downstream API does its job, it refuses.** An access token is issued for an audience, and a resource server has to reject a token whose `aud` does not name it. RFC 9068 §4 makes that a MUST for JWT access tokens, and RFC 9700 §2.3 asks for every access token to be restricted to one resource server (or a few) and for resource servers to refuse tokens that were not meant for them. The forwarded token was made for `orders-api`, so the Inventory API answers 401.

**If the downstream API accepts it anyway**, or every API is registered under one shared audience so that forwarding "works", the system has bigger problems:

- **Replay.** Any API that receives the token can present it to every other API that accepts it. One compromised service, or one token in a log file, then reaches everything, with all the authority the user gave the original client. RFC 9700 §4.9 describes this leak at a resource server and names audience restriction as a countermeasure.
- **Confused deputy.** An API that honours a token never meant for it exercises authority nobody granted it. Ana agreed that the Shop app may place orders for her; she did not agree that whoever ends up holding that token may read stock or change prices. The opposite shortcut fails from the other side: if the Orders API drops the user and calls downstream with its own service credentials, the Inventory API sees only a trusted service, and anyone who can steer the Orders API borrows its privileges.
- **Too much, for too long.** The original token carries every scope the client was granted and lives as long as the client needs it. Each extra hop that sees it widens what a leak can do.
- **No trail.** Downstream logs show the user and nothing else. Nothing records which service made the call.
- **It may not even work.** A sender-constrained token (DPoP, or bound to a client certificate) is tied to a key that only the original client holds, so a service in the middle cannot present it.

What each hop needs is a token of its own: made for that one API, limited to what that call requires, short-lived, still about the same user, and honest about which service is acting for her.

## How it works

OAuth 2.0 Token Exchange (RFC 8693) adds one grant type to the token endpoint: a client hands the authorization server a token it holds and gets a different one back. The RFC introduces it with this very case: a resource server takes the client role and trades the access token it was called with for one that suits a call to a backend service.

**The request** is a form-encoded `POST` to the token endpoint:

| Parameter | Required | What it carries |
|---|---|---|
| `grant_type` | yes | `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | yes | The token of the party the request is made on behalf of. Here: the user's access token, exactly as the Orders API received it |
| `subject_token_type` | yes | What kind of token that is, for example `urn:ietf:params:oauth:token-type:access_token` |
| `actor_token` | no | A token of the party that will act with the new token. Here: the Orders API's own access token |
| `actor_token_type` | with `actor_token` | Its type. Required when `actor_token` is sent, not allowed otherwise |
| `audience` | no | The target service by logical name, a name that client and server both know |
| `resource` | no | The target as an absolute URI without a fragment (the resource indicator of RFC 8707) |
| `scope` | no | The scope wanted at the target |
| `requested_token_type` | no | The kind of token wanted back. Left out, the server decides |

Besides `access_token`, the RFC defines type identifiers ending in `refresh_token`, `id_token`, `saml1` and `saml2`, and reuses `urn:ietf:params:oauth:token-type:jwt`. `audience` and `resource` can be repeated and mixed, but a request that names several targets asks for one token that works at all of them, which is the opposite of what this pattern is for.

The client authenticates to the token endpoint as it would for any other grant. RFC 8693 leaves it to the authorization server whether unauthenticated clients may exchange at all, and says why they should not: without client authentication, anyone holding a stolen token could turn it into further tokens. For a middle-tier API that means a confidential client. [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) shows the ways a service proves who it is, and the same grant can give it the token it sends as `actor_token`.

**The decision.** The authorization server validates the subject token and, when there is one, the actor token, each according to its type. Then it applies policy: may this client exchange this token, for this target, with this scope? If the request or either token is unacceptable, the error is `invalid_request`. If the server will not issue a token for the audience or resource that was asked for, it is `invalid_target`.

**The response** is an ordinary token response with one addition:

- `access_token`: the new token. The name is historical: it holds whatever was issued, even when that is not an access token.
- `issued_token_type`: what was issued, as one of the type identifiers.
- `token_type`: how to present it: `Bearer`, or `N_A` when the result is not an access token.
- `expires_in`: the lifetime in seconds (recommended).
- `scope`: required whenever it differs from the scope that was requested.
- `refresh_token`: optional, and normally absent when one short-lived credential is traded for another.

**What the new token says.** RFC 8693 also defines the JWT claims that make delegation visible:

- `act` (actor) says that delegation has happened and identifies the acting party. Its value is a JSON object whose members identify the actor: `sub`, together with `iss` where that is needed to tell actors apart. Claims such as `exp` or `aud` mean nothing inside it.
- Nesting records a chain. The outermost `act` is the current actor, and each `act` inside it is an earlier one, the oldest innermost. For access decisions an API may use only the token's top-level claims and the current actor. Earlier actors are history for the audit log, not something to authorize on.
- `may_act` points the other way: placed in a token, it names a party that is allowed to become the actor for that token's subject. An authorization server can check the requester against it when the token arrives as a `subject_token`.

The exchanged token in the diagram therefore reads `aud: inventory-api`, `sub: ana`, `scope: inventory:read`, `act: {"sub": "orders-api"}`. After the second exchange it reads `aud: pricing-api`, `sub: ana`, `scope: pricing:read`, `act: {"sub": "inventory-api", "act": {"sub": "orders-api"}}`.

**Delegation or impersonation.** These are the RFC's two names for what the new token means. With **delegation** the token identifies both parties: the subject and, in `act`, the actor working for the subject. With **impersonation** the token identifies only the subject, so for whoever receives it the caller simply is the user. The RFC's own examples draw the line at the request: a `subject_token` alone gives impersonation, and delegation takes an `actor_token` as well. In the end it is the authorization server's policy that decides whether a token with both parties is issued, and servers differ in where they take the actor from: some want the `actor_token`, others use the authenticated client. Prefer delegation between services. The downstream API can then tell "Ana" from "the Orders API on Ana's behalf", authorize on both, and log both.

**Every hop repeats it.** The exchange is not special to the first hop. The Inventory API exchanges the token it received in the same way, and the server nests the previous actor inside the new one. No token in the chain is accepted by more than one API, and the exchanged ones last only a few minutes.

## When to use it

- **A service in the middle of a user's request calls another API as that user:** an API calling a downstream API, a chain of microservices, a worker or an AI agent acting for the person who started the task.
- **The downstream API authorizes per user** (Ana's orders, Ana's prices) or has to record who a call was for.
- **Trust boundaries inside the system:** different teams, different sensitivity, or a zero-trust posture in which no API accepts a token just because it arrived from inside the network.
- **Changing the token at a boundary:** an [API Gateway](../api-gateway/) that swaps an external token for an internal one, or one kind of token for another (the RFC also covers ID tokens and SAML assertions).
- **Not when there is no user in the call.** A service acting on its own authority has nothing to exchange: use [OAuth 2.0 Client Credentials](../oauth2-client-credentials/).
- **Not for a single API.** If the request ends where it lands, the API only has to validate the token it was given: see [JWT Validation](../jwt-validation/).
- **Not from a browser or a mobile app.** The party that exchanges should authenticate to the token endpoint, and that takes a confidential client. A public client gets its tokens through [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) instead.

## Trade-offs

- **An extra call on the request path.** Each new pair of user and target costs a round trip to the token endpoint before the downstream call can start, and a chain of three services pays it at every hop. Caching (below) removes most of that, but the first call after a token expires always pays.
- **The authorization server becomes a runtime dependency of every hop.** With plain validation an API needs the issuer only to refresh its keys now and then. With exchange, an outage or a rate limit at the token endpoint stops every call that has no cached token. Size and monitor the token endpoint as part of the request path, and put a timeout on the exchange call.
- **The policy has to be kept, and kept narrow.** Which client may exchange which tokens, for which targets and scopes, is a table somebody has to maintain. A loose one ("any client, any audience") turns exchange into a way of converting one stolen token into tokens for everything: the replay problem again, now with the authorization server's help.
- **Exchange does not link the tokens.** RFC 8693 treats an exchange as a one-off event. Renewing or revoking the user's token changes nothing about tokens already exchanged from it unless the server adds that itself; Keycloak, for one, documents that revoking the original access token leaves the exchanged access token valid. Short lifetimes are what bound the gap.
- **A bearer token still works for whoever holds it.** A narrow audience and scope shrink what a leaked token can do. They do not stop its use at its one audience until it expires. Sender-constrained tokens close that gap, but check how your server treats a sender-constrained `subject_token`: Keycloak accepts one only from the client it was issued to, with proof of possession.
- **Impersonation hides the middle.** A token without `act` is easier for downstream APIs that only understand `sub`. The price is an audit trail that cannot tell the user from the services acting for her, and no way to apply rules per calling service.
- **Token size and privacy.** Every hop adds a level to `act`, and every claim travels on every call. RFC 8693 asks deployments to put only the minimum necessary into issued tokens.
- **Support is uneven.** Not every authorization server implements the grant, and those that do differ on `actor_token`, `act`, `resource` and the token types they accept. Check before you design around a particular feature.

## Implementation notes

- **Decide who may exchange what, and default to no.** Authenticate the exchanging client and allow confidential clients only. Accept a subject token only from a party it was issued for: Microsoft Entra ID requires the incoming token's `aud` to be the application that is asking, and Keycloak requires the requesting client to be among the token's audiences. Keep an allowlist per client of targets and scopes, never issue more than the user's own grant covers, and give each hop only what its downstream call needs.
- **Ask for one target, by name.** Send `audience` or `resource` and the narrowest scope that works. Not every server takes both parameters: Keycloak's standard token exchange does not support `resource` yet.
- **Cache exchanged tokens.** Key the cache on the incoming token (a hash of it) or on the user and session, together with the target audience and scope. Reuse the token until shortly before `expires_in` runs out, and keep it in memory or in an encrypted shared cache, never in logs. Libraries often do this for you: MSAL.NET's on-behalf-of call looks in its token cache before it goes to the network. Never share an entry between users, and remember that a cached token outlives the user's sign-out by up to its lifetime.
- **Validate downstream as usual,** exactly as in [JWT Validation](../jwt-validation/): signature, `iss`, `aud`, `exp`, then scope. After that, authorize on `sub` and, where it matters, on the current actor in `act.sub` ("the Orders API may read stock for any user, the Reporting API may not"). Do not authorize on nested actors.
- **Log subject and actor.** Record `sub`, the whole `act` chain, the token's `jti` and your trace ID on every call. That is the trail forwarding never gave you: which user, through which services.
- **Handle refusals.** `invalid_target` or `invalid_request` from the exchange means that policy said no. Do not fall back to forwarding the original token or to the service's own credentials. When the authorization server wants something only the user can provide (Entra ID answers `interaction_required` when the downstream API demands MFA, for example), pass the challenge back up to the client with a 401.
- **Alternatives and neighbours** (status checked in October 2026):
  - **Microsoft Entra ID's on-behalf-of flow** has the same intent with a different grant: the middle tier posts the incoming token as `assertion` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and `requested_token_use=on_behalf_of`. It works for user tokens only, yields delegated scopes rather than application roles, and returns a refresh token only when `offline_access` is requested.
  - **Cloud security token services** use the RFC 8693 grant for a different job, workload identity federation. Google Cloud's Security Token Service takes an external credential (an OIDC or SAML token, or a signed AWS request) as the subject token and returns a federated access token. There is no user and no call chain, only a workload crossing into another trust domain.
  - **Transaction tokens** (draft-ietf-oauth-transaction-tokens) take the opposite approach to a call chain inside one trust domain: instead of a token per hop, a transaction token service issues one short-lived JWT for the whole transaction. It is requested with a profile of token exchange and passed along unchanged in a `Txn-Token` header; its `aud` is the trust domain, not a single API, and it is deliberately not an access token. Still an Internet-Draft: revision 11 has working group consensus and has not yet gone to the IESG.
  - **Identity chaining across domains** (draft-ietf-oauth-identity-chaining) covers a next hop that belongs to another trust domain with its own authorization server: exchange the token at home for a JWT authorization grant, then present that grant to the other domain's token endpoint with the JWT bearer grant of RFC 7523. Approved and in the RFC Editor's queue, not yet published as an RFC.
  - **A service mesh or mutual TLS** authenticates the calling workload, not the user. Use it together with token exchange, not instead of it: see [Service Mesh](../service-mesh/) and [Mutual TLS (mTLS)](../mutual-tls/).
- **Server support, as examples:** Keycloak ships standard token exchange (enabled by default, switched on per client), with `actor_token` delegation and the `act` and `may_act` claims as a preview feature. Spring Security's authorization server accepts the token-exchange grant, and its OAuth 2.0 client sends the current request's token as the subject token, plus an actor token if you supply a resolver. Okta offers on-behalf-of token exchange on custom authorization servers. Auth0 has two features: On-Behalf-Of Token Exchange for calls between your own APIs, which nests the exchanging client in `act`, and Custom Token Exchange, which runs an Action that you write to validate other kinds of subject token and can record an actor. Duende IdentityServer leaves the grant to an extension grant validator that you implement; its sample takes the actor from the authenticated client rather than from an `actor_token`.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- Zero Trust Access *(planned)* — No implicit trust from network location: verify identity, device and context on every request.

## References

- [RFC 8693 — OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)
- [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- [RFC 7523 — JSON Web Token (JWT) Profile for OAuth 2.0 Client Authentication and Authorization Grants](https://www.rfc-editor.org/rfc/rfc7523)
- [Microsoft identity platform — OAuth 2.0 On-Behalf-Of flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)
- [Microsoft Authentication Library for .NET — On-behalf-of flows with MSAL.NET](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/on-behalf-of-flow)
- [Google Cloud IAM — Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
- [Google Cloud IAM — Security Token Service API, Method: token](https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token)
- [IETF OAuth WG — Transaction Tokens (draft-ietf-oauth-transaction-tokens)](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/)
- [IETF OAuth WG — OAuth Identity and Authorization Chaining Across Domains (draft-ietf-oauth-identity-chaining)](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/)
- [Keycloak — Configuring and using token exchange](https://www.keycloak.org/securing-apps/token-exchange)
- [Spring Security — OAuth 2.0 Authorization Server: Protocol Endpoints](https://docs.spring.io/spring-security/reference/servlet/oauth2/authorization-server/protocol-endpoints.html)
- [Spring Security — OAuth 2.0 Client: Authorization Grant Support](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html)
- [Okta Developer — Set up OAuth 2.0 On-Behalf-Of Token Exchange](https://developer.okta.com/docs/guides/set-up-token-exchange/main/)
- [Auth0 Docs — On-Behalf-Of Token Exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange)
- [Auth0 Docs — Custom Token Exchange](https://auth0.com/docs/authenticate/custom-token-exchange)
- [Duende IdentityServer — Extension Grants](https://docs.duendesoftware.com/identityserver/tokens/extension-grants/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
