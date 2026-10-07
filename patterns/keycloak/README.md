<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Keycloak

> An open-source identity provider: user sign-in, federation and single sign-on, issuing OpenID Connect and SAML tokens.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Keycloak" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/keycloak.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Keycloak is Acme Shop's identity provider: realm **acme** holds the users, roles, sign-in flows and signing keys, and three clients, **shop-web** (the shop's single-page app, a public client), **back-office** (the staff app, a confidential client) and **orders-api** (the resource server). The apps send people to Keycloak to sign in and get tokens back, and orders-api checks each access token's RS256 signature against the realm's public keys, so it never sees a password. Customers can also sign in with Google (identity brokering), and staff accounts stay in Active Directory, which Keycloak reads over LDAP (user federation). |
| **2 · Sign-in with PKCE** | The customer clicks **Sign in** on shop.example, and shop-web sends the browser to the realm's `/auth` endpoint with a `code_challenge`, the S256 hash of a random `code_verifier`. There is no SSO cookie yet, so the realm's **browser flow** asks for the password and then a 6-digit OTP (a passkey would replace both), creates an **SSO session**, stores it in the database and redirects back with a one-time code. shop-web posts the code and the `code_verifier` to `/token` and gets an ID token, an access token (RS256, 5 minutes) and a refresh token (30 minutes). |
| **3 · Tokens and single sign-on** | orders-api fetched the realm's JWKS once and caches it, so it checks each access token itself: the signature, `iss`, `aud` (an audience mapper adds orders-api), `exp` and the realm role **customer** in `realm_access.roles`. Before the 5 minutes run out, shop-web refreshes, which also resets the session's 30-minute idle timer. A staff member who signed in to the wiki earlier opens back-office: the **Cookie** step finds their SSO session, so Keycloak returns a code without a login form, and back-office redeems it at `/token` with its client secret. |
| **4 · Revocation and limits** | Support switches the customer's **Enabled** off. The next refresh fails with `400 invalid_grant`, but orders-api keeps accepting the access token it already holds until `exp`, up to 5 minutes later, which is why access tokens are short; token introspection would see the change at once, at the cost of a call to Keycloak per request. Keycloak is also a stateful service to run: PostgreSQL holds realms, users and sessions, the nodes share embedded Infinispan caches, a multi-cluster setup needs a synchronously replicated database, and upgrades and themes are your work, which managed services such as Amazon Cognito, Auth0 and Microsoft Entra ID take on in exchange for control. |
<!-- END GENERATED: header -->

## The problem

Acme Shop has two kinds of users and three applications. Customers sign up on shop.example; staff already have accounts in the company's Active Directory. Without a shared identity provider, shop-web and back-office would each store passwords and build their own MFA, sessions and password resets, and orders-api would have to trust each app's idea of who is calling. Every new app repeats that work, and a staff account that should be closed stays open in any app someone forgot.

An identity provider takes the job out of the apps. They send people to one sign-in service, which authenticates them and returns signed tokens, and APIs check the signatures. Keycloak is an open-source identity and access management server under the Apache License 2.0 that speaks OpenID Connect, OAuth 2.0 and SAML 2.0, and Acme runs it itself. It joined the CNCF at the incubating level in April 2023, and Red Hat sells a supported distribution, the Red Hat build of Keycloak. Versions and defaults on this page are those of Keycloak 26.8.0 (1 October 2026).

## How it works

**Realms.** A realm is a separate space with its own users, credentials, roles, groups, clients, sign-in flows, signing keys and settings, and its own issuer. For realm `acme` that is `https://id.shop.example/realms/acme`, and its OpenID Connect endpoints sit below it under `/protocol/openid-connect/`: `auth`, `token`, `certs`, `userinfo`, `logout`, `token/introspect`, `revoke` and `auth/device`. The discovery document at `/.well-known/openid-configuration` lists them all; this page shortens them to `/auth`, `/token` and `/certs`. The built-in `master` realm is for administering Keycloak itself; applications get realms of their own.

**Clients.** Each application is a client of the realm and uses OpenID Connect or SAML. A client with *Client authentication* off is **public**: it can't keep a secret, as in a single-page or mobile app, so it depends on exact redirect URIs and PKCE. shop-web is one, with its *PKCE method* set to `S256`. With *Client authentication* on, the client is **confidential** and proves itself at the token endpoint with a secret, a signed JWT or a client certificate; back-office uses a secret. Switches on each client decide which grants it may use: *Standard flow* (authorization code), *Direct access grants* (the password grant, which [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) says not to use), *Service account roles* (client credentials), *Standard Token Exchange*, *OAuth 2.0 Device Authorization Grant* and *OIDC CIBA Grant*. A resource server such as orders-api is a client too, usually with every flow switched off, because it only receives tokens.

**Users, roles and the claims in a token.** Users live in the realm's database or in a federated directory (see *User federation* below). Roles are realm roles, such as `customer`, or client roles that belong to one client, and groups carry role mappings that their members inherit. What goes into a token is configuration, not code: **client scopes** (`profile`, `email`, `roles`, `offline_access` and your own) bundle **protocol mappers**, and each mapper writes a claim. By default realm roles land in `realm_access.roles` and client roles in `resource_access.<client>.roles`, and a token carries only the roles the user has *and* the client's scope allows. An *Audience* mapper puts `orders-api` into `aud`, so the API can refuse tokens that were meant for someone else.

**Authentication flows.** Sign-in is a flow of steps you can rearrange. The built-in *browser* flow tries **Cookie** first, and an existing SSO session ends the flow there. Next come *Kerberos* (disabled by default) and the *Identity Provider Redirector*, which jumps straight to a default or hinted provider, and then the forms: the *Username Password Form*, followed by the *Browser - Conditional 2FA* sub-flow, which asks for a one-time code only if the user has set one up. The default OTP policy is TOTP with 6 digits every 30 seconds; WebAuthn security keys and recovery codes sit in the same sub-flow, disabled by default. **Passkeys** have been supported since 26.4. With *Enable Passkeys* on (Realm settings, Login tab), the username forms offer a passkey through the browser's autofill or a *Sign in with Passkey* button, and the 2FA step is skipped after a passkey. Flows can be copied and changed: conditions, sub-flows, step-up by authentication level, required actions such as `CONFIGURE_TOTP` and `UPDATE_PASSWORD`, and custom authenticators. Brute-force detection is off in a new realm.

**Sessions and single sign-on.** A successful sign-in creates a user session, the SSO session, with one client session per application, and sets the `KEYCLOAK_IDENTITY` cookie on Keycloak's host. The next application that sends the browser there is answered from that session without a form. *SSO Session Idle* (30 minutes by default) ends a session nobody has used, *SSO Session Max* (10 hours) ends it in any case, and *Client Session Idle* and *Client Session Max* can shorten both for one client. Since 26.0, user sessions are stored in the database by default and cached in memory, so they survive restarts and upgrades. Signing out at the realm's logout endpoint ends the SSO session, and Keycloak tells the other clients by **front-channel** logout (the browser calls each client's logout URL) or **back-channel** logout (Keycloak posts a logout token to the client's back end). Offline tokens (`scope=offline_access`) outlive the session for background work and expire after 30 days without use.

**Tokens and keys.** Access tokens are JWTs signed with the realm's active key, RS256 unless you change *Default Signature Algorithm*, and they live 5 minutes (*Access Token Lifespan*). A refresh token expires when its client session would go idle, 30 minutes after it was issued by default, and never later than *SSO Session Max*; each refresh returns a new one. *Revoke Refresh Token* is off by default, so an old refresh token keeps working until it expires; switch it on to make every refresh token single-use, as in [Refresh Token Rotation](../refresh-token-rotation/). The public halves of the realm's keys are published as a JWKS at `/certs`. A realm signs with one active key pair and can keep passive keys that only verify, so a rotation adds a new key with a higher priority and leaves the old one passive until the tokens it signed have expired.

**Grants and protocols** (status in 26.8):

| What | Status | Notes |
|---|---|---|
| Authorization code with PKCE | supported | `S256` can be required per client |
| Client credentials | supported | *Service account roles* on a confidential client |
| Device authorization grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) | supported | switched on per client |
| Standard token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) | supported since 26.2 | Keycloak token for Keycloak token only, confidential clients only |
| Legacy token exchange (V1) | preview, deprecated | external tokens and impersonation |
| Token exchange delegation | preview | the `act` claim; disabled by default |
| JWT authorization grant (RFC 7523) | supported since 26.6 | |
| DPoP, FAPI 2.0 | supported since 26.4 | sender-constrained tokens |
| SAML 2.0 | supported | Keycloak as the identity provider for SAML apps |

SAML clients share users, flows and SSO sessions with the OpenID Connect clients, so an older SAML app and a new OIDC app sign in once.

**User federation.** An LDAP or Active Directory provider makes the directory's users usable in a realm. Keycloak never imports passwords: the directory checks them. It can import users into its own database the first time they appear and keep them current with a periodic full or changed-users sync, or, with *Import Users* off, read them from the directory each time. *Edit mode* decides where changes go: `READ_ONLY`, `WRITABLE` (written back to LDAP) or `UNSYNCED` (kept in Keycloak). Mappers bring in attributes, groups and roles, and the *MSAD User Account* mapper carries Active Directory's account state across, so a `userAccountControl` of 514, a disabled account, disables the user in Keycloak too. Kerberos (SPNEGO) gives single sign-on to domain-joined desktops, and the User Storage SPI connects any other user database.

**Identity brokering.** Keycloak can also be the client of another identity provider: any OpenID Connect or SAML 2.0 provider, or one of the built-in social providers such as Google, GitHub, Facebook, Microsoft and LinkedIn. The provider shows up as a button on the login page, or is chosen directly with `kc_idp_hint`. After the first sign-in, the *first login flow* creates a local user or links an existing one, and mappers copy claims onto it. The applications never talk to Google: they still get Keycloak's tokens.

**Administration and auditing.** Everything in the admin console is also in the Admin REST API (`/admin/realms/{realm}/…`) and the `kcadm.sh` command-line tool, so realms can be scripted and exported or imported as JSON. A SCIM API, supported since 26.8, lets provisioning systems manage a realm's users and groups, and fine-grained admin permissions (version 2, supported since 26.2) hand parts of a realm to a help desk. User events (`LOGIN`, `LOGIN_ERROR`, `CODE_TO_TOKEN`, `REFRESH_TOKEN` …) and admin events aren't stored by default, apart from errors written to the log, until you switch on *Save events* with an expiration; event listeners forward them elsewhere.

**Themes and extensions.** The login pages, account console, admin console, emails and welcome page are themes: FreeMarker templates, message bundles, stylesheets and images, chosen per realm. The default login theme has been `keycloak.v2` since 26.0, and a custom theme extends a built-in one. Extensions such as authenticators, user stores, event listeners and protocol mappers are Java providers (SPIs) placed in `providers/` and built into the server with `kc.sh build`.

**Running it.** Keycloak has been a Quarkus application since version 17, and the old WildFly-based distribution was removed in 20. `kc.sh start-dev` runs a development server with the `dev-file` database and local caches only. `kc.sh start` is production mode, which expects a hostname, TLS (or a proxy that terminates it) and a real database: [PostgreSQL](../postgresql/), MySQL, MariaDB, Microsoft SQL Server or Oracle, plus [Amazon Aurora](../amazon-rds-aurora/) PostgreSQL and Azure SQL. Nodes form a cluster on their own, finding each other through the database (`jdbc-ping`, the default since 26.1), and share embedded Infinispan caches: local caches for realms, users and keys on each node, and distributed caches for authentication sessions, user sessions and action tokens. Health and metrics endpoints are served on a separate management port, 9000. On [Kubernetes](../kubernetes/), the Keycloak Operator runs the server from a `Keycloak` resource and imports realms from `KeycloakRealmImport` resources.

## Where it fits

- **Solutions:** customer sign-in for web and mobile apps, single sign-on for staff apps, B2B portals where each partner company signs in with its own identity provider (Organizations, supported since 26.0), API and microservice platforms that validate JWTs, multi-tenant SaaS with a realm or organization per tenant, and SAML for older enterprise apps.
- **Patterns in this catalog it implements:** [OpenID Connect](../openid-connect/) sign-in, the [authorization code flow with PKCE](../oauth2-authorization-code-pkce/) for public clients, [SAML SSO](../saml-sso/) as the identity provider, [Federated Identity](../federated-identity/) through brokering and LDAP, [Client Credentials](../oauth2-client-credentials/) for service accounts, [Token Exchange](../token-exchange/), the [Device Authorization Grant](../device-authorization-grant/), [Refresh Token Rotation](../refresh-token-rotation/) with *Revoke Refresh Token* on, and the server-side half of [Sessions vs Tokens](../sessions-vs-tokens/): an SSO session behind short-lived tokens. The APIs do [JWT Validation](../jwt-validation/) with its keys, or an [API Gateway](../api-gateway/) does it for them. Browser apps that shouldn't hold tokens at all put a [Backends for Frontends](../backends-for-frontends/) in front, registered as a confidential client.
- **Usual neighbours:** a reverse proxy or load balancer in front (TLS, forwarded headers), PostgreSQL behind, an SMTP server for verification and password-reset emails, LDAP or Active Directory, external identity providers, the apps and APIs that use its tokens, and your metrics and log pipeline.
- **Managed offerings:** AWS has no managed Keycloak; teams run it on Amazon EKS or [Amazon ECS](../amazon-ecs/) with Aurora PostgreSQL. The Keycloak project's own high-availability tests run on Red Hat OpenShift Service on AWS with Aurora PostgreSQL, and its multi-cluster setup puts AWS Global Accelerator in front. AWS's managed identity provider is **[Amazon Cognito](../amazon-cognito/)**. Red Hat supports the Red Hat build of Keycloak, whose documentation was at 26.6 in October 2026; Auth0 (Okta) and Microsoft Entra ID are hosted alternatives.

## When to use it

Use Keycloak when you want an identity provider you run and control: on your own servers or in your own cloud account, with standard protocols, LDAP, Active Directory and Kerberos for staff, brokering to social and enterprise providers, sign-in flows and pages you can reshape, and no per-user licence. Choose a managed service when nobody on the team should be on call for the login page, or when your users already live in one vendor's identity platform.

| | Keycloak | Amazon Cognito | Auth0 (Okta) | Microsoft Entra ID |
|---|---|---|---|---|
| Who runs it | you, optionally with Red Hat support | AWS | Okta, as a service | Microsoft |
| Cost model | no licence fee (Apache 2.0); you pay for servers, database and operations | per monthly active user, by feature plan (Lite, Essentials, Plus) | subscription plans priced by monthly active users | per-user licences (Free, P1, P2) for staff; External ID billed by monthly active users |
| Protocols for your apps | OpenID Connect, OAuth 2.0, SAML 2.0 | OpenID Connect, OAuth 2.0 | OpenID Connect, OAuth 2.0, SAML, WS-Federation | OpenID Connect, OAuth 2.0, SAML 2.0 |
| Users from elsewhere | LDAP and AD, Kerberos, OIDC and SAML providers, social logins | SAML and OIDC providers; Google, Facebook, Apple, Amazon | AD and LDAP through a connector on your network; SAML, OIDC, social | on-premises AD through Microsoft Entra Connect; social and enterprise providers in External ID |
| Custom logic | Java providers (SPIs) and flows | [Lambda](../aws-lambda/) triggers | Actions (Node.js) | custom authentication extensions (calls to your REST API) |
| Default access-token lifetime | 5 minutes | 1 hour (up to 1 day) | 24 hours for a custom API | random, 60 to 90 minutes |
| Choose it when | you need control, self-hosting or on-premises directories | your apps run on AWS and you want no servers | you want a hosted service with many ready-made integrations | your staff already sign in with Microsoft |

## Trade-offs

- **You run a tier-0 service.** When Keycloak or its database is down, nobody can sign in and no token can be refreshed. Plan for it like a database: several nodes across availability zones, a highly available database, backups, monitoring and someone on call.
- **Revocation lags by one access token.** Disabling a user or ending a session stops refreshes at once, but an API that checks signatures locally keeps accepting the access token it already has until `exp`. Short lifespans bound that window; introspection closes it at the cost of a call per request ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)).
- **Upgrades are regular work.** A minor release has come about every three months (26.6 in April, 26.7 in July and 26.8 in October 2026), with patch releases in between. Custom themes and providers have to be tested against each one; since 26.6, patch releases within a minor version can roll through a cluster without downtime.
- **Sessions cost database work.** With sessions stored in the database, every sign-in and refresh writes to it, and the multi-cluster v2 setup roughly doubles the database's CPU and write load, according to the documentation. The project reports testing a single cluster with 1,000,000 users at 300 requests per second, and scaling to 30 million users with 1,000 logins and 20,000 token refreshes per second on six large pods and an Aurora cluster; size your own deployment with a load test.
- **Multi-site has limits.** Multi-cluster v2, supported since 26.8 and switched on with `--features=stateless`, keeps all session state in a synchronously replicated database and needs a commit latency below 10 ms (5 ms suggested), so it fits availability zones or nearby data centres in one region, not distant regions. Multi-cluster v1, the older setup with an external Infinispan cluster, is deprecated.
- **Many switches, and some defaults to change.** The power to reshape flows and claims is also room for mistakes: wildcard redirect URIs, *Direct access grants* left on, brute-force detection and event storage off.

## Implementation notes

The scenario's realm as an import file (abridged; the three timeouts are the defaults, written out for clarity):

```json
{
  "realm": "acme",
  "enabled": true,
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "roles": { "realm": [ { "name": "customer" } ] },
  "clients": [
    {
      "clientId": "shop-web",
      "publicClient": true,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": [ "https://shop.example/callback" ],
      "webOrigins": [ "https://shop.example" ],
      "attributes": { "pkce.code.challenge.method": "S256" },
      "protocolMappers": [
        {
          "name": "orders-api audience",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": { "included.client.audience": "orders-api", "access.token.claim": "true" }
        }
      ]
    },
    { "clientId": "back-office", "publicClient": false, "standardFlowEnabled": true,
      "redirectUris": [ "https://backoffice.shop.example/callback" ] },
    { "clientId": "orders-api", "publicClient": false, "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false }
  ]
}
```

- **Keep configuration as code.** Export realms to JSON and import them with `KeycloakRealmImport`, `kcadm.sh` or the Admin REST API, so a change goes through review instead of a click in the console. Keep `master` for administrators only.
- **Production start.** Run `kc.sh build` with your providers and options, then `kc.sh start --optimized`, with the hostname set (`--hostname https://id.shop.example`), the proxy headers your load balancer sends (`--proxy-headers xforwarded`), and TLS on Keycloak or at the proxy. On Kubernetes, the Operator's `Keycloak` resource holds the same settings:

```yaml
apiVersion: k8s.keycloak.org/v2beta1
kind: Keycloak
metadata:
  name: acme-id
spec:
  instances: 3
  db:
    vendor: postgres
    host: acme-id-db
    usernameSecret: { name: acme-id-db, key: username }
    passwordSecret: { name: acme-id-db, key: password }
  http:
    tlsSecret: acme-id-tls
  hostname:
    hostname: id.shop.example
  proxy:
    headers: xforwarded
```

- **Make the APIs strict.** Check `iss`, `aud`, `exp` and the algorithm on every token, cache the JWKS but fetch it again when a token names an unknown `kid`, and read roles from `realm_access.roles` or `resource_access`. An API that checks only the signature accepts a token issued for any client of the realm; an audience mapper plus an `aud` check prevents that.
- **Change the risky defaults.** Turn on brute-force detection, *Save events* (with an expiration) and *Revoke Refresh Token*, a realm setting that makes each refresh token single-use, which matters most for public clients such as shop-web. Turn off *Direct access grants* and the implicit flow where nobody uses them, and register exact redirect URIs.
- **Keep the token window small.** Leave access tokens at a few minutes. If an API must notice a disabled user or a logout sooner than `exp`, let that API call the introspection endpoint instead of checking signatures only.
- **Back up the database.** Since 26.0 it holds the sessions as well as the realms, users and credentials, and a restore is how you recover from a bad change.
- **Directory changes reach Keycloak on a schedule.** With imported LDAP users, set a changed-users sync, so attributes and account state from Active Directory arrive in time; passwords are always checked live against the directory.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [SAML 2.0 Single Sign-On](../saml-sso/) — Enterprise SSO: the identity provider posts a signed assertion to the app through the browser.
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Amazon Cognito](../amazon-cognito/) — Sign-up and sign-in for your app's users: user pools issue OpenID Connect tokens, identity pools trade them for AWS credentials.

## References

- [Keycloak — Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [Keycloak — Release notes](https://www.keycloak.org/docs/latest/release_notes/index.html)
- [Keycloak on GitHub — Release 26.8.0 (1 October 2026)](https://github.com/keycloak/keycloak/releases/tag/26.8.0)
- [Keycloak — Securing applications and services with OpenID Connect (endpoints)](https://www.keycloak.org/securing-apps/oidc-layers)
- [Keycloak — Specifications implemented](https://www.keycloak.org/securing-apps/specifications)
- [Keycloak — Configuring and using token exchange](https://www.keycloak.org/securing-apps/token-exchange)
- [Keycloak — Enabling and disabling features](https://www.keycloak.org/server/features)
- [Keycloak — Configuring distributed caches](https://www.keycloak.org/server/caching)
- [Keycloak — Configuring the database](https://www.keycloak.org/server/db)
- [Keycloak — High availability overview](https://www.keycloak.org/high-availability/introduction)
- [Keycloak — Single-cluster deployments](https://www.keycloak.org/high-availability/single-cluster/introduction)
- [Keycloak — Multi-cluster deployments (v2)](https://www.keycloak.org/high-availability/multi-cluster-v2/introduction)
- [Keycloak — Basic Keycloak deployment (Operator)](https://www.keycloak.org/operator/basic-deployment)
- [Keycloak — Working with themes](https://www.keycloak.org/ui-customization/themes)
- [Keycloak — Configuring the management interface](https://www.keycloak.org/server/management-interface)
- [Keycloak — Configuring Keycloak (build and start --optimized)](https://www.keycloak.org/server/configuration)
- [Keycloak — Configuring Keycloak for production](https://www.keycloak.org/server/configuration-production)
- [Keycloak — Configuring the hostname (v2)](https://www.keycloak.org/server/hostname)
- [Keycloak — Configuring a reverse proxy](https://www.keycloak.org/server/reverseproxy)
- [Keycloak — Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html)
- [Keycloak source, 26.8.0 — Constants.java (realm defaults: token lifespan, session timeouts, RS256)](https://github.com/keycloak/keycloak/blob/26.8.0/server-spi-private/src/main/java/org/keycloak/models/Constants.java)
- [Keycloak source, 26.8.0 — DefaultRefreshTokenProvider.java (refresh token expiry)](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/protocol/oidc/refresh/DefaultRefreshTokenProvider.java)
- [Keycloak source, 26.8.0 — CookieType.java (KEYCLOAK_IDENTITY and the other cookie names)](https://github.com/keycloak/keycloak/blob/26.8.0/server-spi-private/src/main/java/org/keycloak/cookie/CookieType.java)
- [CNCF — Keycloak (incubating project)](https://www.cncf.io/projects/keycloak/)
- [Red Hat — Red Hat build of Keycloak](https://access.redhat.com/products/red-hat-build-keycloak/)
- [OpenID Connect Core 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)
- [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients (PKCE)](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 7662 — OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662)
- [RFC 8628 — OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [Amazon Cognito Developer Guide — User pool sign-in with third party identity providers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html)
- [Amazon Cognito API Reference — CreateUserPoolClient (token validity)](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html)
- [Amazon Cognito Developer Guide — User pool feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)
- [Amazon Cognito Developer Guide — Customizing user pool workflows with Lambda triggers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [Auth0 Docs — Authentication and Authorization Protocols](https://auth0.com/docs/authenticate/protocols)
- [Auth0 Docs — Access Tokens (token lifetime)](https://auth0.com/docs/secure/tokens/access-tokens)
- [Auth0 Docs — Understand How Auth0 Actions Work](https://auth0.com/docs/customize/actions/actions-overview)
- [Auth0 Docs — Connect Your App to Active Directory using LDAP](https://auth0.com/docs/authenticate/identity-providers/enterprise-identity-providers/active-directory-ldap)
- [Auth0 — Pricing](https://auth0.com/pricing)
- [Microsoft Learn — Access tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)
- [Microsoft Learn — How the Microsoft identity platform uses the SAML protocol](https://learn.microsoft.com/en-us/entra/identity-platform/saml-protocol-reference)
- [Microsoft Learn — What is hybrid identity with Microsoft Entra ID?](https://learn.microsoft.com/en-us/entra/identity/hybrid/whatis-hybrid-identity)
- [Microsoft Learn — Microsoft Entra External ID overview](https://learn.microsoft.com/en-us/entra/external-id/external-identities-overview)
- [Microsoft Learn — Microsoft Entra licensing](https://learn.microsoft.com/en-us/entra/fundamentals/licensing)
- [Microsoft Learn — External ID pricing](https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
