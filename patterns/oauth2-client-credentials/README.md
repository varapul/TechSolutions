<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# OAuth 2.0 Client Credentials

> Machine-to-machine access tokens, with no user involved.

<p align="center"><img src="diagram.svg" alt="Animated diagram: OAuth 2.0 Client Credentials" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/oauth2-client-credentials.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Ask as itself** | A backend service needs to call an API on its own account: here an Orders service calling the Inventory API, though it could just as well be a nightly billing job. It sends `POST /token` with `grant_type=client_credentials` and `scope=inventory:read` straight to the authorization server and authenticates as itself, in this case with its `client_id` and `client_secret` in an HTTP Basic header. Nobody signs in, so there is no redirect, no sign-in page and no consent screen; the grant is only for **confidential clients**, software that can keep a credential to itself. |
| **2 · Token issued** | The authorization server authenticates the client against its registration, then checks that this client is allowed the scope it asked for. It returns an access token with `token_type` and `expires_in`, and no refresh token: when the token runs out, the client simply authenticates again. The token's subject is the client itself (`sub` and `client_id` both name `orders-svc`), not a person. |
| **3 · Call and reuse** | The service calls the Inventory API with `Authorization: Bearer …`, and the API validates the token locally: signature, issuer, audience, expiry and scope. The service keeps the token in memory and sends the same one on every call, then asks for a new one shortly before it expires. It does not fetch a token per call, which would add a round trip to every request and push against the token endpoint's rate limits. |
| **4 · Drop the shared secret** | A shared secret has to be stored by the client, crosses the wire on every token request and works for anyone who copies it. Replace it with something that can't leak the same way: a signed JWT assertion made with a private key (`private_key_jwt`, shown here), a client certificate (mutual TLS), or the platform's **workload identity**, a short-lived token that the platform issues to the workload and that is exchanged for an access token, so nothing long-lived is stored at all. |
<!-- END GENERATED: header -->

## The problem

Not every caller is a person. A service calling another service, a nightly billing job, a queue worker or a deployment pipeline has no user to send through a sign-in page, yet the API at the other end still has to know who is calling and what that caller is allowed to do.

The usual shortcuts age badly. A static API key never expires, travels on every request and ends up copied into more places than anyone remembers. A "service user" with a password, pushed through a flow built for people, trips over MFA and hides which system really made the call. Trusting whatever arrives from inside the network holds only until one workload is compromised. What the caller needs is an identity of its own, a way to prove it, and a short-lived, narrowly scoped token that the API can check like any other access token.

## How it works

The client credentials grant (RFC 6749 §4.4) is the shortest OAuth 2.0 flow: one request to the token endpoint and one response. There is no authorization endpoint, no redirect and no authorization code, because nobody is asked for consent at request time: the client acts for itself, or under an arrangement made in advance with the authorization server. Authenticating the client is the whole of the authorization.

1. **Token request.** The client sends a `POST` to the token endpoint with a form-encoded body: `grant_type=client_credentials` and, optionally, `scope`. It authenticates in the same request.
2. **Token response.** The authorization server authenticates the client, decides what this client may have, and returns `access_token`, `token_type` and, normally, `expires_in`.
3. **API call.** The client sends `Authorization: Bearer <token>`. The API validates the token (see [JWT Validation](../jwt-validation/)) and authorizes the request from its claims.
4. **Reuse, then renew.** The client keeps the token in memory, sends it on every call, and repeats step 1 shortly before the token expires.

**Who the client is.** The client is registered with the authorization server in advance: a `client_id`, the way it authenticates, and the scopes or APIs it may ask for. The grant is for **confidential clients** only (RFC 6749 §4.4, and unchanged in the OAuth 2.1 draft): software that runs where its credential can be kept away from users, such as a server, a job or a daemon. A single-page app or a mobile app can't keep one, so it can't use this grant.

**How it proves it.** The methods below come from IANA's OAuth Token Endpoint Authentication Methods registry (which also lists `none`, for public clients), with workload identity federation added, roughly from weakest to strongest:

| Method | What the client holds | What goes to the token endpoint |
|---|---|---|
| `client_secret_basic`, `client_secret_post` (RFC 6749 §2.3.1) | A shared secret | The secret itself, in an HTTP Basic header or in the form body |
| `client_secret_jwt` (OpenID Connect Core §9) | A shared secret | A short-lived JWT protected by an HMAC keyed with the secret: the secret stays off the wire, but both sides still know it |
| `private_key_jwt` (RFC 7523, OpenID Connect Core §9) | A private key | A short-lived JWT signed with that key, in `client_assertion`. The server holds only the public key |
| `tls_client_auth`, `self_signed_tls_client_auth` (RFC 8705) | A private key and an X.509 certificate | Nothing beyond `client_id`: the TLS handshake proves possession of the key, and the server matches the certificate to the client |
| Workload identity federation | Nothing long-lived | A short-lived token that the platform issued to the workload, sent as the `client_assertion` or as the subject token of a token exchange |

RFC 9700, the OAuth security best current practice, recommends the asymmetric methods, mutual TLS or `private_key_jwt`: the authorization server then has no symmetric secret to keep, so a leak on its side can't be used to pose as the client.

**What the token says.** With no user involved, the token is about the client. In the JWT access token profile (RFC 9068), `sub` should be the identifier the authorization server uses for the client application, and `client_id` is always present; `aud` names the API and `scope` says what the client may do there.

**Why there is no refresh token.** A refresh token lets a client get new access tokens without sending the user through the flow again. Here nobody would be sent anywhere: the client can authenticate again whenever it needs to, so a refresh token would only be one more long-lived secret to store. RFC 6749 §4.4.3 words it as a "SHOULD NOT" and leaves the reason unstated, and servers follow it in practice: Microsoft Entra ID never issues one in this flow, and Keycloak leaves it off unless a deprecated switch is turned on.

## When to use it

- **Service-to-service calls** in which the caller acts on its own authority: Orders reading stock levels, a reporting service pulling from a billing API.
- **Scheduled jobs, batch runs, queue workers and daemons**: anything that runs unattended.
- **Automation**: CI/CD pipelines, operators and infrastructure tooling that call management APIs.
- **Not for anything that acts for a user.** When a person is behind the request, use a user flow such as [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/), so that the token carries that user's identity and consent. A service in the middle of a user's request that has to call a downstream API as that user should exchange the token it received (OAuth 2.0 Token Exchange, RFC 8693, the on-behalf-of pattern) instead of switching to its own client credentials. Otherwise the user vanishes from the audit trail, and the service's broad permissions take the place of what the user was allowed to do.
- **Not for public clients.** Browsers, mobile apps and desktop apps can't keep a client credential.

## Trade-offs

- **The client credential is the thing to protect.** Whoever holds it can get tokens as the service, at any hour and from anywhere. A shared secret is the weakest form: it sits in configuration, pipelines and, too often, source control; it is sent whole on every token request; and a copy works as well as the original. Asymmetric methods keep the private key on the client's side, and workload identity leaves no stored credential at all.
- **No user means no user-shaped limits.** A token from this grant carries application-level permissions: `inventory:write` means all inventory, not one customer's. Least privilege has to come from the registration: one client per workload, the narrowest scopes that work, and tokens restricted to a single audience (RFC 9700 §2.3).
- **A bearer token works for whoever holds it.** One leaked from a log or a compromised hop can be replayed until it expires. Keep lifetimes short, and for high-value APIs bind the token to a key that only the client has: certificate-bound tokens over mutual TLS (RFC 8705, `cnf.x5t#S256`) or DPoP (RFC 9449, `cnf.jkt`). RFC 9700 recommends sender-constrained access tokens.
- **Revocation is coarse.** There is no session to end. Disabling the client or rotating its credential stops new tokens, but tokens already issued keep passing local validation until `exp`.
- **The token endpoint becomes a dependency.** A cached token rides out a short outage of the authorization server. A client that asks for a token on every call turns every hiccup, and every rate limit, into failed requests.
- **Clients and users can be confused.** If client IDs and user IDs share a namespace, an API can take a client's `sub` for a user's. RFC 9700 §4.15 tells authorization servers not to let clients choose their own `client_id` in that case, or else to give APIs another way to tell the two kinds of token apart.
- **Workload identity moves the trust; it doesn't remove it.** The authorization server now trusts the platform's token issuer and a subject string such as a Kubernetes service account or a repository and branch. Anything that can run under that subject gets the tokens, so the trust rule must pin issuer, subject and audience exactly.

## Implementation notes

- **The request.** The body is form-encoded (`application/x-www-form-urlencoded`), not JSON; it goes over TLS, with credentials never in the URL and only one authentication method per request. With HTTP Basic, RFC 6749 §2.3.1 has the client form-urlencode the ID and the secret before joining and Base64-encoding them, a step implementations have skipped often enough that the OAuth 2.1 draft (draft 16 of September 2026, still a working-group document) reverses the default: servers must accept the credentials in the form body and may accept Basic as well. Check which one your server expects.
- **Errors.** Failed client authentication is `invalid_client` (HTTP 401 when the client used the `Authorization` header), a scope the client may not have is `invalid_scope`, and a client that isn't allowed this grant gets `unauthorized_client` (RFC 6749 §5.2). All three are configuration problems, so alert on them instead of retrying.
- **Cache the token.** Key the cache by authorization server, client, audience and scope. Reuse the token until shortly before `expires_in` runs out, with a margin that covers clock skew and requests in flight; make the renewal single-flight, so that a burst of calls triggers one token request instead of a hundred; and when an API answers 401 to a cached token, drop it and fetch a new one once. Most OAuth client libraries do this for you: MSAL's `AcquireTokenForClient`, for example, checks its application token cache before it calls the token endpoint. With many replicas, share the cache or spread the renewals out.
- **Lifetime and limits.** A shorter lifetime narrows the replay window and raises the token-request rate; an hour is a common default (Microsoft Entra ID assigns each token a default lifetime of 60 to 90 minutes). Token endpoints are rate-limited and sometimes metered: Entra ID throttles a client that asks too often, and Amazon Cognito bills machine-to-machine use by active app clients and by token requests, and points to caching as the way to keep that down.
- **Scopes, audience and resource.** Ask for one API per token. The standard way to name the API is the `resource` parameter (RFC 8707). Without it, RFC 9068 has the server derive `aud` from the requested scopes, and it should refuse a request whose scopes point at different APIs. Vendors differ: Auth0 takes an `audience` parameter with the API's identifier; Microsoft Entra ID takes `scope=<resource>/.default` and puts the application permissions an administrator granted into a `roles` claim; Cognito issues only the custom scopes (`resource-server/scope`) assigned to the app client and doesn't accept `resource` for this grant.
- **In the API.** Authorize on the client's identity (`client_id` or `sub`) together with scopes or roles, and establish whether a token belongs to a client or to a user before trusting `sub`. Nothing in the token says which person, if any, caused the call; if the API needs that, this is the wrong grant.
- **`private_key_jwt`.** The assertion is a JWT with `iss` and `sub` set to the client ID, `aud` naming the authorization server, a short `exp` and a unique `jti` (RFC 7523, OpenID Connect Core §9), sent as `client_assertion` together with `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`. Where the server supports it, register a `jwks_uri` instead of a fixed public key, so that rotating the key needs no change at the server, and keep the private key in a KMS or HSM that signs on request. An update to RFC 7523 (draft-ietf-oauth-rfc7523bis, approved and in the RFC Editor's queue as of October 2026) closes an audience-confusion attack: `aud` must be the authorization server's issuer identifier and nothing else, no longer the token endpoint URL, and the JWT should be typed `client-authentication+jwt`. Products are still catching up (Okta's guide for service apps, for one, shows the token endpoint URL as `aud`), so follow your server's documentation.
- **Mutual TLS.** `tls_client_auth` validates the certificate chain and matches one registered subject (a DN or a SAN), so a renewed certificate with the same subject needs no change at the server. `self_signed_tls_client_auth` skips the chain and matches the certificate against those registered in the client's JWKS. Where TLS ends at a load balancer, the certificate has to reach the authorization server in a form it can trust; RFC 8705 leaves that to the deployment.
- **Workload identity federation.** The platform that runs a workload already knows what it is and can say so in a short-lived signed token: a Kubernetes projected service-account token (bound to an audience and to the pod, and replaced by the kubelet at 80% of its lifetime or after 24 hours, so re-read the file), a SPIFFE SVID from the Workload API (an X.509 certificate or a JWT, obtained with no bootstrap secret), or a cloud provider's token (AWS workloads can ask STS `GetWebIdentityToken` for a JWT). The authorization server is told to trust that issuer for one subject and audience, and the workload presents the token where a secret would have gone. Microsoft Entra ID accepts it as the `client_assertion` of an ordinary client credentials request, matched against a federated identity credential on the app. Google Cloud exchanges it at its Security Token Service, following OAuth 2.0 Token Exchange (RFC 8693). Keycloak 26.8 can take Kubernetes service-account tokens as client assertions (the feature is on by default) and SPIFFE JWT-SVIDs as a preview feature. An IETF working-group draft, OAuth SPIFFE Client Authentication, is standardising the SPIFFE case.
- **If you keep a secret.** Let the authorization server generate it, store it in a secret manager (never in source, images or anything shipped to users), and give every workload its own client, so that a leak is contained and traceable. Rotate on a schedule with two credentials valid at once: Cognito allows two active secrets per app client, and Auth0 two registered public keys, so the new one can be rolled out before the old one is removed. Alert before a secret or certificate expires: an expired credential is an outage.
- **Products.** Every mainstream authorization server supports the grant; they differ in what can replace the secret. Microsoft Entra ID accepts a secret, an assertion signed with a certificate's key, or a federated credential, and its MSAL documentation marks secrets as not recommended for production. Auth0 supports a client secret, Private Key JWT (Enterprise plan) and mutual TLS (Enterprise plan with the Highly Regulated Identity add-on). Okta's own management APIs accept only `private_key_jwt` from service apps. Amazon Cognito authenticates app clients with a client secret, at the token endpoint or through its `GetClientToken` API. Keycloak enables the grant per client with "Service accounts roles" and can authenticate the client by secret, signed JWT or X.509 certificate.
- **Where the tokens are checked.** An [API gateway](../api-gateway/) can validate them before a request reaches a service. Inside a [service mesh](../service-mesh/), mutual TLS already tells each service which workload is on the other end of the connection; an access token adds scopes and an audience, and it still means something after the request has passed through a gateway or proxy that terminates TLS.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- Token Exchange (On-Behalf-Of) *(planned)* — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- Zero Trust Access *(planned)* — No implicit trust from network location: verify identity, device and context on every request.

## References

- [RFC 6749 — The OAuth 2.0 Authorization Framework (§4.4 Client Credentials Grant)](https://www.rfc-editor.org/rfc/rfc6749#section-4.4)
- [RFC 6749 — The OAuth 2.0 Authorization Framework (§2.3 Client Authentication)](https://www.rfc-editor.org/rfc/rfc6749#section-2.3)
- [RFC 7523 — JSON Web Token (JWT) Profile for OAuth 2.0 Client Authentication and Authorization Grants](https://www.rfc-editor.org/rfc/rfc7523)
- [IETF OAuth WG — Updates to OAuth 2.0 JSON Web Token (JWT) Client Authentication and Assertion-Based Authorization Grants (draft-ietf-oauth-rfc7523bis, to update RFC 7523)](https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc7523bis/)
- [OpenID Connect Core 1.0 incorporating errata set 2 — §9 Client Authentication](https://openid.net/specs/openid-connect-core-1_0.html#ClientAuthentication)
- [IANA — OAuth Parameters: OAuth Token Endpoint Authentication Methods](https://www.iana.org/assignments/oauth-parameters/oauth-parameters.xhtml#token-endpoint-auth-method)
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705)
- [RFC 9068 — JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [IETF OAuth WG — The OAuth 2.1 Authorization Framework (draft-ietf-oauth-v2-1)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)
- [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693)
- [Microsoft identity platform — OAuth 2.0 client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
- [Microsoft Authentication Library for .NET — Client credential flows](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/client-credential-flows)
- [Microsoft identity platform — Configurable token lifetimes](https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes)
- [Microsoft Entra Workload ID — Workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [Google Cloud IAM — Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
- [AWS IAM — Federating AWS identities to external services (outbound identity federation)](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_outbound.html)
- [Kubernetes — Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)
- [SPIFFE — SPIFFE Concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)
- [IETF OAuth WG — OAuth SPIFFE Client Authentication (draft-ietf-oauth-spiffe-client-auth)](https://datatracker.ietf.org/doc/draft-ietf-oauth-spiffe-client-auth/)
- [Auth0 Docs — Application Credentials](https://auth0.com/docs/secure/application-credentials)
- [Auth0 Docs — Call Your API Using the Client Credentials Flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-credentials-flow/call-your-api-using-the-client-credentials-flow)
- [Okta Developer — Implement OAuth for Okta with a service app](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/)
- [Amazon Cognito — Scopes, M2M, and resource servers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
- [Keycloak — Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
