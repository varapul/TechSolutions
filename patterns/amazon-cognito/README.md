<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# Amazon Cognito

> Sign-up and sign-in for your app's users: user pools issue OpenID Connect tokens, identity pools trade them for AWS credentials.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Amazon Cognito" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/amazon-cognito.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's customers sign up and sign in through the user pool **acme-customers** (us-east-1, Essentials plan): managed login pages on `auth.shop.example`, email as the username, required MFA, **Sign in with Google**, and Lambda triggers that screen sign-ups and add claims to tokens. The single-page app **shop-web** receives OpenID Connect tokens, and API Gateway checks the access token before the orders API runs (AppSync and Application Load Balancers work with user pools too). The identity pool **acme-shop**, which costs nothing, trades the ID token for temporary AWS credentials, so the browser uploads photos straight to S3. |
| **2 · Sign in with managed login** | shop-web keeps a random `code_verifier` and sends Ana to `/oauth2/authorize` with its SHA-256 hash (`S256`, the only PKCE method Cognito accepts). On the managed login page she gives her email, password and a TOTP code (a passkey with user verification, or Continue with Google, would also do), and the **pre token generation** trigger, on event version `V2_0`, adds the claim `tier: gold` to her tokens. Cognito redirects back with an authorization code, and shop-web redeems it with the verifier at `/oauth2/token` for an ID token and an access token (1 hour each by default) and a refresh token (30 days by default). |
| **3 · Using the tokens** | shop-web calls `GET /orders` with the access token. The REST API's **COGNITO_USER_POOLS** authorizer accepts only an unexpired token that the pool signed (its public keys are in the pool's JWKS) and, because the method declares the scope `orders/read`, only an access token that carries it; anything else gets 401, and the claims, `tier` included, reach the backend. For the upload, the identity pool takes the ID token: `GetId` returns Ana's identity ID `us-east-1:9f3c…`, `GetCredentialsForIdentity` has STS issue one-hour credentials for the role **photo-uploader**, and the browser signs a `PutObject` under `photos-prod/u/us-east-1:9f3c…/`, the only prefix the role allows her. |
| **4 · Limits and lock-in** | Revoking Ana's refresh token (`RevokeToken` or `/oauth2/revoke`) stops refreshes and makes Cognito's own APIs refuse its access tokens, but an API that verifies JWTs by itself accepts them until they expire. Request rates are quotas per category, shared by every user pool in the account and Region (October 2026: `UserAuthentication` 120 per second, `UserCreation` 50, `UserFederation` 25), and the bill is per monthly active user by plan (US East: Lite $0.0055 falling to $0.0025 and Essentials $0.015, both after 10,000 free, Plus $0.02). Managed login takes your logo, colours and layout but not your own text, no API returns password hashes (moving users in is easier, with the migrate user trigger or a CSV import), and a pool lives in one Region, with one limited replica if you add multi-Region replication; Keycloak (self-hosted), Auth0 and Microsoft Entra External ID are the usual alternatives. |
<!-- END GENERATED: header -->

## The problem

Acme Shop wants customer accounts. People sign up with their email address, sign in with a password and a second factor or with their Google account, reset passwords they forget, and stay signed in on their own browser for weeks. The orders API has to know who is calling without asking a session store on every request, and the photo feature should let the browser upload straight to S3 instead of streaming every byte through a server.

Built by hand, that means storing password hashes and choosing the hashing well, sending and checking verification codes, slowing down password guessing, running an OAuth 2.0 and OpenID Connect server with signing keys that rotate, and keeping up with each social provider's quirks. It also means deciding how a browser, which can't keep a secret, gets AWS credentials that can only write that one customer's photos.

## How it works

Amazon Cognito is AWS's identity service for an application's own users, such as customers and partners. The people and workloads that run the AWS account belong to [AWS IAM](../aws-iam/) and IAM Identity Center instead. Cognito has two parts with similar names and different jobs.

### User pools and identity pools

| | User pool | Identity pool |
|---|---|---|
| What it is | a user directory plus an OAuth 2.0 authorization server and OpenID Connect provider | a broker that turns proof of a sign-in into temporary AWS credentials |
| Takes | passwords, passkeys, one-time codes, or a sign-in at Google, Apple, Facebook, Amazon, a SAML 2.0 or an OIDC provider | an ID token from a user pool or another OIDC provider, a SAML assertion, a social provider's token, or nothing at all for guests |
| Gives | JSON Web Tokens: an ID token, an access token and a refresh token | a stable identity ID, and credentials for an IAM role issued by AWS STS |
| Price | per monthly active user, by feature plan | no charge (the AWS calls made with the credentials are billed as usual) |
| In Acme Shop | `acme-customers` | `acme-shop` |

Each works without the other: many applications need only a user pool, and an identity pool can trust another identity provider. Amazon Cognito Sync, the identity pools' old service for syncing device data, stopped taking new customers in July 2026; AWS suggests AppSync and [DynamoDB](../amazon-dynamodb/) instead.

### App clients and OAuth 2.0 flows

An app client is a user pool's settings for one application: the sign-in methods and OAuth grants it may use, the scopes it may request, its callback URLs, its token lifetimes, and whether it has a client secret.

- **Public and confidential clients.** `shop-web`, a single-page app, is a **public client** with no secret, because anything shipped to a browser or a phone can be read. A **confidential client** runs on a server and authenticates at the token endpoint with a client secret (`client_secret_basic` or `client_secret_post`); since January 2026 an app client can hold two secrets at once, so a secret can be rotated without downtime.
- **Authorization code with PKCE** is the flow for people. The app sends the browser to `/oauth2/authorize` with a `code_challenge` (Cognito supports only the `S256` method), the user signs in, the browser comes back with a code, and the app exchanges the code and its `code_verifier` at `/oauth2/token` for an ID token, an access token and a refresh token. For public clients, Cognito's documentation recommends allowing this grant only, always with PKCE.
- **Client credentials** is the flow for machines. A confidential app client asks for an access token carrying custom scopes defined on a resource server, at the token endpoint or, since July 2026, through the `GetClientToken` API, which needs no user pool domain. It is billed per token request, not per user (US East, October 2026: $2.25 per 1,000 requests for the first 250,000 in a month, falling to $1.125 per 1,000 above five million, with no charge for the app clients themselves). Its quota category, `ClientAuthentication`, allows 150 requests per second and can't be raised, so callers should cache each token until it expires.
- **Implicit** returns the ID and access tokens directly in the redirect URL: no refresh token, no PKCE, and tokens exposed to browser history and to anything that can read the URL. RFC 9700, the IETF's current OAuth 2.0 security best practice, says not to use it; leave it switched off.

Apps that draw their own sign-in screens skip the browser redirect and call the user pool API through an AWS SDK: `InitiateAuth` with `USER_AUTH` (choice-based sign-in with a password, a passkey or a one-time code), `USER_SRP_AUTH` (the Secure Remote Password protocol, so the password never crosses the network), `USER_PASSWORD_AUTH`, or a custom challenge flow built from Lambda triggers.

### Managed login and custom domains

A user pool domain serves the OAuth 2.0 endpoints (`/oauth2/authorize`, `/oauth2/token`, `/oauth2/userInfo`, `/oauth2/revoke`, `/oauth2/idpresponse`) and the hosted sign-in pages. It is either a prefix domain, such as `acme.auth.us-east-1.amazoncognito.com`, or a custom domain, such as `auth.shop.example`. A custom domain needs a public certificate in AWS Certificate Manager in US East (N. Virginia), because Cognito serves it through a CloudFront distribution, and its parent domain (`shop.example`) must resolve in DNS. With both kinds of domain, the OpenID Connect discovery document is published only on the custom one.

The pages come in two generations:

- **Managed login** (November 2024, Essentials and Plus plans) supports passkeys, one-time codes and localized pages, and has a visual branding editor for logos, background images, colours, light and dark modes and the layout of the form.
- **The classic hosted UI**, the only choice on the Lite plan, takes a logo and a fixed set of CSS properties.

Neither lets you change the wording on the pages; managed login can only switch them to another supported language. Neither handles profile changes, such as a new email address or MFA preferences, which your app builds on the user pool API, and managed login doesn't run custom authentication challenges. After a sign-in, a session cookie lets the same browser sign in again without credentials for one hour.

### Federation

A user pool can hand sign-in to Google, Facebook, Login with Amazon, Sign in with Apple, any SAML 2.0 identity provider or any OpenID Connect provider, and then issues its own tokens as usual. Acme Shop registers an OAuth client with Google, gives it `https://auth.shop.example/oauth2/idpresponse` as the redirect URI and requests the scopes `openid email profile`; an attribute mapping copies Google's email into the profile that Cognito keeps for each federated user. Managed login shows a Continue with Google button, and an app can skip the page by adding `identity_provider=Google` to the authorize request.

The pre sign-up trigger also runs at a federated user's first sign-in, and since January 2026 an inbound federation trigger can reshape the provider's attributes on the way in. Federated users do MFA at their own provider; Cognito doesn't add a factor. Users from social providers are priced like the pool's own users, and users from SAML 2.0 or OIDC providers at a separate rate.

### MFA and passkeys

MFA can be off, optional or required, with three kinds of second factor: a TOTP code from an authenticator app (Cognito accepts codes from 30 seconds either side, to allow for clock drift), an SMS message and, on Essentials or Plus, an email message. SMS goes out through [Amazon SNS](../amazon-sns/) and email through Amazon SES, each billed separately.

**Passkeys** (Essentials or Plus) are WebAuthn credentials held by a phone, a laptop or a security key. In Cognito a passkey is a **first factor**, offered through choice-based sign-in and managed login, never a second step after a password. In a pool that requires MFA, a passkey sign-in counts as MFA only if the authenticator verifies the user (with a PIN or a biometric) and the pool's WebAuthn setting `FactorConfiguration` is `MULTI_FACTOR_WITH_USER_VERIFICATION`. That is how Acme Shop lets customers choose between a TOTP code and a passkey. A user can register up to 20 passkeys, only after signing in once; the relying party ID defaults to the custom domain (`auth.shop.example`), and changing it later means everyone registers again. Sign-in with a one-time code as the first factor can't be combined with required MFA.

### Threat protection

On the Plus plan, threat protection (formerly advanced security features) compares passwords used at sign-in, sign-up and password changes against leaked credentials, scores the risk of each sign-in from signals such as an unfamiliar device or location (adaptive authentication), and can allow it, demand MFA or block it at each risk level. It starts in audit mode, which only logs and publishes metrics; AWS suggests two weeks or more there before switching on full-function mode. Leaked-password checks need the password itself, so they don't cover SRP or custom authentication, and threat protection doesn't apply to federated sign-in at all.

### Lambda triggers

Triggers call your Lambda functions at fixed points in a user's life:

| Trigger | Runs | In Acme Shop |
|---|---|---|
| Pre sign-up | before a user is created: self-service sign-up, admin creation, a federated user's first sign-in | rejects disposable email domains |
| Post confirmation | after a user confirms the account | (a welcome email, a customer record) |
| Pre and post authentication | before and after a sign-in | (block a user, log the sign-in) |
| Pre token generation | before tokens are issued, also on refresh | adds `tier: gold` |
| Migrate user | when an unknown user signs in with a password or asks for a reset | (moving users from an old system) |
| Custom message, custom sender | when Cognito sends a code or a link | (own templates, another email or SMS provider) |
| Define, create and verify auth challenge | in a custom authentication flow | — |
| Inbound federation | when a federated user signs in | — |

Except for the custom sender triggers, Cognito calls the function synchronously and waits at most 5 seconds, a limit you can't change; it may retry a call that times out. A function that returns an error stops that step of the flow: managed login shows the error's message above the sign-in form, and the API returns it as `PreSignUp failed with error …`. Pre token generation has three event versions: `V1_0` changes only the ID token and works on every plan, `V2_0` also changes the access token's claims and scopes, and `V3_0` does the same for machine-to-machine tokens; the last two need Essentials or Plus.

### Tokens: lifetimes, refresh and revocation

Cognito signs its JWTs with RS256, with one key for ID tokens and another for access tokens, and publishes the public keys at `https://cognito-idp.us-east-1.amazonaws.com/<user pool ID>/.well-known/jwks.json`; the `kid` in a token's header names the key.

- The **ID token** describes the user (`sub`, `email`, `cognito:username`, groups and custom claims such as `tier`) and is meant for the app; its `aud` is the app client ID.
- The **access token** describes what the caller may do: its `scope` (`openid email orders/read`), its `cognito:groups`, and the app client in `client_id`. It carries an `aud` only when the app asks for a resource binding (RFC 8707, supported since October 2025).
- The **refresh token** is opaque to the app. It buys new ID and access tokens at the token endpoint (`grant_type=refresh_token`) or through the `GetTokensFromRefreshToken` API.

Each app client sets the lifetimes. By default ID and access tokens last 1 hour (configurable from 5 minutes to 1 day) and refresh tokens 30 days (60 minutes to 10 years). Because the managed login cookie keeps the browser signed in for an hour anyway, AWS advises against ID or access tokens shorter than an hour when you use managed login. **Refresh token rotation** (Essentials or Plus) returns a new refresh token with every refresh and invalidates the old one, after a grace period of up to 60 seconds if you set one; the new token still expires when the first one would have.

Revocation works on refresh tokens. `RevokeToken` and `/oauth2/revoke` end one refresh token and the access and ID tokens issued from it; `GlobalSignOut` and `AdminUserGlobalSignOut` end all of a user's tokens. Cognito's own APIs then refuse those access tokens, but the tokens themselves are still correctly signed and unexpired, so an API that verifies them by itself accepts them until `exp`. Revocation is on by default for new app clients, and it adds the `jti` and `origin_jti` claims to the tokens.

### Groups and role mapping

Users can belong to groups, listed in `cognito:groups` in both tokens, which APIs and AppSync can authorize on. A group can also name an IAM role and a precedence: the ID token then lists the roles in `cognito:roles` and, when one group wins, names it in `cognito:preferred_role`, which an identity pool can use to choose the role.

### Identity pools

In the **enhanced flow**, the app calls `GetId` with the ID token in a logins map, under the key `cognito-idp.us-east-1.amazonaws.com/<user pool ID>`, and gets an identity ID such as `us-east-1:9f3c…`, the same for that user on every device. It then calls `GetCredentialsForIdentity`: Cognito calls `AssumeRoleWithWebIdentity` itself and returns credentials that last one hour. In the **basic flow** the app calls `GetOpenIdToken` and then STS itself, which lets it pick the role and the session length, but the basic flow doesn't work in a pool with role mappings.

The identity pool chooses the role:

- **Default roles.** One role for authenticated identities (`photo-uploader`) and, if guest access is on, one for unauthenticated identities. Acme Shop leaves guests off. Guests in the enhanced flow get a scope-down session policy that limits them to a list of services.
- **Rules and token-based mapping.** Rules match claims in the token (for example `tier` equals `gold`) to roles, in order, and token-based mapping takes `cognito:preferred_role` from the user pool's groups. A setting decides what happens when nothing matches: the default role, or a denial.
- **Attributes for access control.** The pool copies claims into session tags, so one role's policy can compare `aws:PrincipalTag/tier` with a tag on the resource. The role's trust policy must then also allow `sts:TagSession`, and users must not be able to edit the attributes that become tags: check every app client's write permissions.

Each role's trust policy names the federated principal `cognito-identity.amazonaws.com` and restricts `cognito-identity.amazonaws.com:aud` to your identity pool IDs; since August 2025 IAM refuses to save a new or changed trust policy for that principal without the condition. In the permissions policy, the variable `${cognito-identity.amazonaws.com:sub}` is the identity ID (not the user pool's `sub`), which is how `photo-uploader` keeps each customer inside `photos-prod/u/<identity ID>/`. Because the browser calls S3 directly, the bucket also needs a CORS rule for the shop's origin.

### Integrations: API Gateway, ALB, AppSync and Amplify

- **API Gateway REST APIs** have a `COGNITO_USER_POOLS` authorizer. On a method without OAuth scopes it treats the token as an ID token; on a method with scopes it requires an access token that carries one of them and answers 401 otherwise. Mapping templates can pass the claims to the backend as `$context.authorizer.claims`.
- **API Gateway HTTP APIs** use a JWT authorizer, with the user pool as issuer and the app client ID as audience. It checks `kid` and the signature against the issuer's JWKS (caching the keys for up to two hours), then `iss`, `aud` or `client_id`, `exp`, `nbf`, `iat` and the route's scopes, as described in [JWT validation](../jwt-validation/).
- **Application Load Balancers** have an `authenticate-cognito` listener action: the load balancer runs the sign-in, keeps the session in a cookie and passes the user's claims to the targets in `x-amzn-oidc-*` headers, of which it signs `x-amzn-oidc-data`.
- **AppSync** GraphQL APIs accept user pool tokens (`AMAZON_COGNITO_USER_POOLS`) and can restrict fields to groups with `@aws_auth(cognito_groups: [...])`.
- **Amplify** builds its Auth category on Cognito user pools and identity pools.

### Pricing and quotas

Prices in US East (N. Virginia), October 2026:

| Plan | Price per monthly active user (MAU) | Free each month | Adds |
|---|---|---|---|
| Lite | $0.0055 from 10,001 to 100,000 MAUs, falling in tiers to $0.0025 above 10 million | 10,000 MAUs | sign-up and sign-in, social, SAML and OIDC federation, TOTP and SMS MFA, Lambda triggers, the classic hosted UI |
| Essentials (the default for new pools) | $0.015 | 10,000 MAUs | managed login and its branding editor, passkeys and one-time codes, email MFA, access token customization, refresh token rotation, password history |
| Plus | $0.02 | none | threat protection, and logs of user activity and risk that you can export |

A user counts as active in a month with any identity operation: a sign-up, a sign-in, a token refresh, a password change, an admin lookup. Users federated through SAML 2.0 or OIDC cost $0.015 each after the first 50, on every plan. User pools created on or before November 22, 2024 keep the old free tier of 50,000 MAUs on Lite. Add-ons cost extra: machine-to-machine tokens (per request, above), multi-Region replication ($0.0045 per MAU on Essentials, $0.006 on Plus) and higher request rates ($20 per extra request per second for a month or more, $45 for less, subject to approval). Identity pools cost nothing; SMS and email are billed by SNS and SES.

The request-rate quotas, also as of October 2026, apply per category and are shared by all the user pools of an account in one Region:

| Category | Covers, for example | Default (requests per second) | Adjustable |
|---|---|---|---|
| `UserAuthentication` | `InitiateAuth`, `RespondToAuthChallenge`, token refresh, managed login sign-in | 120 | yes |
| `UserCreation` | `SignUp`, `ConfirmSignUp`, `AdminCreateUser` | 50 | yes |
| `UserFederation` | sign-ins through a third-party provider | 25 | yes |
| `UserAccountRecovery` | `ForgotPassword`, `ChangePassword` | 30 | no |
| `UserRead` | `GetUser`, `AdminGetUser` | 120 | yes |
| `UserUpdate` | `AdminUpdateUserAttributes`, `GlobalSignOut` | 25 | no |
| `UserToken` | `RevokeToken` | 120 | yes |
| `ClientAuthentication` | client credentials grants, `GetClientToken` | 150 | no |

Each step of a managed login sign-in counts, so a sign-in with an MFA code is two requests. On top of the categories, one user can make at most 10 reads and 10 writes per second, and a user pool domain serves at most 500 requests per second (300 from one IP address, 300 for one app client). Identity pools have quotas per operation instead, such as 25 per second for `GetId` and 200 for `GetCredentialsForIdentity`. By default an account can have 1,000 user pools per Region, and a pool 1,000 app clients and 40 million users; all three can be raised.

## Where it fits

- **Solutions.** Sign-in for customer-facing web and mobile apps on AWS; business-to-business SaaS where each customer company signs in through its own SAML 2.0 or OIDC provider; machine-to-machine tokens for internal and partner APIs; and browser or mobile apps that call AWS services directly, such as uploads to S3 or DynamoDB items keyed by the user, through identity pools.
- **Patterns in this catalog.** A user pool is an [OpenID Connect](../openid-connect/) provider and an OAuth 2.0 authorization server: it runs the [authorization code flow with PKCE](../oauth2-authorization-code-pkce/) for apps and the [client credentials](../oauth2-client-credentials/) flow for services. Its optional refresh token rotation retires each refresh token once it is used, as in [refresh token rotation](../refresh-token-rotation/), though the documentation describes no reuse detection. With Google, Apple, SAML 2.0 or OIDC providers configured, it is the broker in [federated identity](../federated-identity/), and the service provider in [SAML single sign-on](../saml-sso/). APIs that trust its tokens do [JWT validation](../jwt-validation/), and an API gateway that checks them for every service is [gateway offloading](../gateway-offloading/). An identity pool is a [token exchange](../token-exchange/): an ID token goes in, AWS credentials for an IAM role come out. Scoped to one prefix with `${cognito-identity.amazonaws.com:sub}`, those credentials work like a [valet key](../valet-key/) to each customer's corner of a bucket.
- **Usual neighbours.** [API Gateway](../api-gateway/), Application Load Balancers, AppSync and Amplify in front; [AWS Lambda](../aws-lambda/) for the triggers; [AWS IAM](../aws-iam/) and STS behind identity pools; [Amazon S3](../amazon-s3/) for direct uploads (the S3 page shows the presigned-URL alternative); Amazon SES and SNS for email and SMS; AWS WAF in front of managed login; CloudTrail for the audit trail; and Amazon Verified Permissions for authorization decisions based on Cognito tokens.
- **Managed offerings.** Cognito is itself a managed, Regional AWS service. The nearest equivalents are Microsoft Entra External ID (Azure AD B2C stopped selling to new customers on May 1, 2025) and Auth0 as services, and [Keycloak](../keycloak/) as the common self-hosted choice.

## When to use it

Choose Cognito when the application runs on AWS, its users are customers or partners, and the standard flows cover what you need: sign-in priced per active user, nothing to operate, and built-in integrations with API Gateway, AppSync, load balancers and, through identity pools, the rest of AWS. Look elsewhere when you need to control the sign-in pages' wording and every step of the flows, one identity system across several clouds, or the option to take password hashes with you later.

As of October 2026:

| | Amazon Cognito | Keycloak | Auth0 (Okta) | Microsoft Entra External ID |
|---|---|---|---|---|
| Runs as | AWS service, one Region per user pool | your servers: open source (Apache 2.0), 26.8.0 released on 1 October 2026 | SaaS | SaaS |
| Pricing | per monthly active user by plan; Essentials $0.015 after 10,000 free (US East) | no licence fee; you pay for servers, a database and operations | Free plan up to 25,000 MAUs, paid plans by MAU | first 50,000 MAUs free on the Basic tier, then per MAU, plus add-ons such as SMS and M2M |
| Sign-in pages | managed login: branding editor, no custom wording; or your own UI on the API | themes: FreeMarker templates, CSS and message bundles, as far as you want to go | Universal Login, with Liquid page templates once you have a custom domain | company branding: background, logo, layout, header, footer and custom text |
| Custom logic | Lambda triggers | Java service provider interfaces (SPIs) and configurable authentication flows | Actions: Node.js functions run at triggers | custom authentication extensions that call your REST API |
| AWS integration | built in: API Gateway, ALB, AppSync, Amplify, identity pools | standard OIDC and SAML | standard OIDC and SAML | standard OIDC and SAML |

Any OIDC provider in that table can also feed an identity pool or an IAM OIDC provider when its users need AWS credentials.

## Trade-offs

- **Priced per active user.** The free tier makes small apps cheap, and the cost grows with users rather than servers. In US East, 200,000 monthly active users cost (200,000 − 10,000) × $0.015 = $2,850 a month on Essentials and 200,000 × $0.02 = $4,000 on Plus, before SMS, email and add-ons.
- **Quotas shape the design.** 120 sign-in requests per second, shared by every user pool in the account and Region, is plenty for most apps but not for a sale that starts at 9:00 sharp: plan the peak, watch `CallCount` and `ThrottleCount` per category in CloudWatch, and buy or request capacity ahead of time. `UserUpdate` (25 per second) and `UserAccountRecovery` (30) can't be raised, so keep admin calls off busy paths.
- **Pages you can style, not rewrite.** Managed login changes look, not wording or flow; anything beyond that means your own UI on the user pool API, with the security work that comes with it.
- **Easier to move in than out.** In: the migrate user trigger moves users one by one as they sign in with their old passwords, and a CSV import can now carry password hashes (bcrypt, scrypt, Argon2id or PBKDF2-SHA256; since July 2026, on user pools that run on Cognito's newer infrastructure), which Cognito converts at each user's first sign-in. Out: no API returns password hashes, so a later move means password resets or a migration in the new system that checks passwords against Cognito as users sign in.
- **Settings fixed at creation.** Whether users sign in with an email address or a phone number as the username, which attributes are required, and every custom attribute you add can't be changed afterwards. Decide them before launch.
- **Regional, with a limited replica.** A user pool lives in one Region. Multi-Region replication (May 2026, Essentials and Plus, an add-on) adds one replica in a second Region, needs a multi-Region KMS key, and fails managed login over through a Route 53 health check. The replica signs users in and issues tokens, but can't create users, reset passwords or change profiles, doesn't support TOTP MFA, and serves federated users only if they signed in to the primary before. For Acme Shop, whose customers use TOTP, that matters.
- **Revocation stops at the token's expiry.** Revoking a refresh token or signing a user out globally doesn't recall access tokens that APIs verify by themselves; keep them short-lived, and check revocation-sensitive actions against Cognito.

## Implementation notes

**The resource server and the app client.** The scope `orders/read` comes from a resource server; `shop-web` is a public client (no secret) that may use the authorization code grant, the pool's own users and Google, and choice-based sign-in for passkeys. `us-east-1_EXAMPLE` stands for the pool's ID:

```sh
aws cognito-idp create-resource-server \
  --user-pool-id us-east-1_EXAMPLE \
  --identifier orders --name "Orders API" \
  --scopes '[{"ScopeName": "read", "ScopeDescription": "Read your own orders"}]'

aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_EXAMPLE \
  --client-name shop-web --no-generate-secret \
  --allowed-o-auth-flows code --allowed-o-auth-flows-user-pool-client \
  --allowed-o-auth-scopes openid email orders/read \
  --supported-identity-providers COGNITO Google \
  --callback-urls https://shop.example/callback \
  --explicit-auth-flows ALLOW_USER_AUTH ALLOW_REFRESH_TOKEN_AUTH
```

**Redeeming the code.** After the redirect, shop-web posts the code and its verifier to the token endpoint. A public client sends its `client_id` in the body and no `Authorization` header:

```http
POST /oauth2/token HTTP/1.1
Host: auth.shop.example
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=<shop-web client ID>&code=<code>&code_verifier=<code_verifier>&redirect_uri=https://shop.example/callback
```

**The two triggers**, as Node.js functions. The disposable domains are examples, and `loyaltyTier` stands for your own lookup. Pre token generation must be configured for event version `V2_0` to change the access token:

```js
const DISPOSABLE = new Set(['tempinbox.example', 'throwaway.example']);

export const preSignUp = async (event) => {
  const domain = event.request.userAttributes.email.split('@').pop().toLowerCase();
  if (DISPOSABLE.has(domain)) throw new Error('Please sign up with a permanent email address.');
  return event;
};

export const preTokenGeneration = async (event) => {
  const tier = await loyaltyTier(event.request.userAttributes.sub); // 'gold' for Ana
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: { claimsToAddOrOverride: { tier } },
      accessTokenGeneration: { claimsToAddOrOverride: { tier } },
    },
  };
  return event;
};
```

**The role behind the identity pool.** The trust policy lets only signed-in identities of this identity pool assume `photo-uploader` (`us-east-1:<identity pool ID>` stands for the pool's ID):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "cognito-identity.amazonaws.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "cognito-identity.amazonaws.com:aud": "us-east-1:<identity pool ID>" },
      "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" }
    }
  }]
}
```

and the permissions policy lets each customer write only under their own identity ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::photos-prod/u/${cognito-identity.amazonaws.com:sub}/*"
  }]
}
```

In the browser, the AWS SDK for JavaScript's `fromCognitoIdentityPool` credential provider takes the identity pool ID and a logins map from `cognito-idp.us-east-1.amazonaws.com/<user pool ID>` to the ID token; an S3 client given that provider signs its requests with the credentials it fetches.

**Habits that keep it manageable:**

- Choose the username attributes, the required attributes and the custom attributes before launch; they can't be changed later.
- Allow only the authorization code grant with PKCE for public clients, and keep implicit off.
- Verify tokens with a maintained library (AWS recommends `aws-jwt-verify` for Node.js) and check `token_use`, `client_id` or `aud`, and the scopes, not just the signature.
- Keep access tokens short, and ask Cognito, not the token, when a revoked session must not act.
- On Plus, run threat protection in audit mode first and look at its risk scores before enforcing.
- Cache machine-to-machine tokens until they expire: each request costs money and counts against a quota that can't be raised.
- Load-test sign-in and sign-up before a launch, and watch `ThrottleCount` per category.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Keycloak](../keycloak/) — An open-source identity provider: user sign-in, federation and single sign-on, issuing OpenID Connect and SAML tokens.
- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.

## References

- [Amazon Cognito Developer Guide — What is Amazon Cognito?](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html)
- [Amazon Cognito Developer Guide — User pool feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- [Amazon Cognito Developer Guide — Quotas in Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html)
- [Amazon Cognito Developer Guide — Document history](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-document-history.html)
- [Amazon Cognito Developer Guide — User pool managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)
- [Amazon Cognito Developer Guide — Apply branding to managed login pages](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-branding.html)
- [Amazon Cognito Developer Guide — The branding editor and customizing managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-brandingeditor.html)
- [Amazon Cognito Developer Guide — Using your own domain for managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html)
- [Amazon Cognito Developer Guide — Application-specific settings with app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)
- [Amazon Cognito Developer Guide — The redirect and authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Amazon Cognito Developer Guide — The token issuer endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [Amazon Cognito Developer Guide — Using PKCE in authorization code grants](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Amazon Cognito Developer Guide — Scopes, M2M, and resource servers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
- [Amazon Cognito Developer Guide — Authentication flows](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html)
- [Amazon Cognito Developer Guide — Adding MFA to a user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html)
- [Amazon Cognito Developer Guide — TOTP software token MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [Amazon Cognito Developer Guide — Using social identity providers with a user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html)
- [Amazon Cognito Developer Guide — Advanced security with threat protection](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-threat-protection.html)
- [Amazon Cognito Developer Guide — Customizing user pool workflows with Lambda triggers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html)
- [Amazon Cognito Developer Guide — Pre sign-up Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html)
- [Amazon Cognito Developer Guide — Pre token generation Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)
- [Amazon Cognito Developer Guide — Migrate user Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-migrate-user.html)
- [Amazon Cognito Developer Guide — Importing users with a user migration Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-import-using-lambda.html)
- [Amazon Cognito Developer Guide — Importing users into user pools from a CSV file](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-using-import-tool.html)
- [Amazon Cognito Developer Guide — Working with user attributes](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html)
- [Amazon Cognito Developer Guide — Understanding the identity (ID) token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-id-token.html)
- [Amazon Cognito Developer Guide — Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [Amazon Cognito Developer Guide — Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- [Amazon Cognito Developer Guide — Ending user sessions with token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [Amazon Cognito Developer Guide — Verifying JSON web tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [Amazon Cognito Developer Guide — Multi-Region replication for user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-multi-region.html)
- [Amazon Cognito Developer Guide — Amazon Cognito identity pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html)
- [Amazon Cognito Developer Guide — Identity pools authentication flow](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow.html)
- [Amazon Cognito Developer Guide — IAM roles](https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html)
- [Amazon Cognito Developer Guide — Using role-based access control](https://docs.aws.amazon.com/cognito/latest/developerguide/role-based-access-control.html)
- [Amazon Cognito Developer Guide — Using attributes for access control](https://docs.aws.amazon.com/cognito/latest/developerguide/attributes-for-access-control.html)
- [Amazon Cognito Developer Guide — Accessing AWS services using an identity pool after sign-in](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-integrating-user-pools-with-identity-pools.html)
- [Amazon Cognito User Pools API Reference — CreateUserPoolClient](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html)
- [Amazon Cognito User Pools API Reference — UserType](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserType.html)
- [Amazon Cognito Federated Identities API Reference — GetCredentialsForIdentity](https://docs.aws.amazon.com/cognitoidentity/latest/APIReference/API_GetCredentialsForIdentity.html)
- [AWS CLI Command Reference — create-user-pool-client](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool-client.html)
- [AWS CLI Command Reference — create-resource-server](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-resource-server.html)
- [Amazon API Gateway Developer Guide — Control access to REST APIs using Amazon Cognito user pools as an authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)
- [Amazon API Gateway Developer Guide — Integrate a REST API with an Amazon Cognito user pool](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-enable-cognito-user-pool.html)
- [Amazon API Gateway API Reference — Method (authorizationScopes)](https://docs.aws.amazon.com/apigateway/latest/api/API_Method.html)
- [Amazon API Gateway Developer Guide — Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Elastic Load Balancing — Authenticate users using an Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html)
- [AWS AppSync Developer Guide — Configuring authorization and authentication to secure your GraphQL APIs](https://docs.aws.amazon.com/appsync/latest/devguide/security-authz.html)
- [AWS Amplify Gen 2 Documentation — Auth concepts](https://docs.amplify.aws/react/build-a-backend/auth/concepts/)
- [Amazon S3 User Guide — Using cross-origin resource sharing (CORS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients](https://www.rfc-editor.org/rfc/rfc7636.html)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
- [Keycloak on GitHub — Release 26.8.0 (1 October 2026)](https://github.com/keycloak/keycloak/releases/tag/26.8.0)
- [Keycloak — Working with themes](https://www.keycloak.org/ui-customization/themes)
- [Keycloak — Server Developer Guide](https://www.keycloak.org/docs/latest/server_development/index.html)
- [Auth0 — Pricing](https://auth0.com/pricing)
- [Auth0 Docs — Understand How Auth0 Actions Work](https://auth0.com/docs/customize/actions/actions-overview)
- [Auth0 Docs — Customize Universal Login Page Templates](https://auth0.com/docs/customize/login-pages/universal-login/customize-templates)
- [Auth0 Docs — Export Data](https://auth0.com/docs/troubleshoot/customer-support/manage-subscriptions/export-data)
- [Microsoft — Microsoft Entra External ID pricing](https://www.microsoft.com/en-us/security/pricing/microsoft-entra-external-id)
- [Microsoft Learn — External ID pricing and billing](https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing)
- [Microsoft Learn — Customize your branding for your customers (Microsoft Entra External ID)](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-customize-branding-customers)
- [Microsoft Learn — Custom authentication extensions overview](https://learn.microsoft.com/en-us/entra/identity-platform/custom-extension-overview)
- [Microsoft Learn — What is Azure Active Directory B2C?](https://learn.microsoft.com/en-us/azure/active-directory-b2c/overview)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
