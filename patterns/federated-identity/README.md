<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Federated Identity

> Let an external identity provider authenticate users; the application trusts its tokens.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Federated Identity" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/federated-identity.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Accounts in every app** | Without federation the application is its own identity store: it keeps a username and password hash for every user and runs password resets and multi-factor setup itself, so partner staff need yet another account. When Bo leaves the partner company, nobody tells the application, and his account here stays active: an **orphaned account** that his old password still opens. |
| **2 · Trust an identity provider** | The application becomes a **relying party**: it sends each user to their home **identity provider** (OpenID Connect or SAML), checks the signed token or assertion that comes back against the provider's published keys, the issuer and the audience, and only then starts its own session. It never sees a password: password rules, multi-factor authentication and account recovery belong to the provider. Each trust is set up once, by exchanging metadata (issuer, endpoints, signing keys). |
| **3 · One broker, many providers** | Instead of one trust per provider, the application trusts a single **federation broker**, and the broker trusts the company's provider, the partner's and a social provider. **Home realm discovery** picks the right one, here from the email domain: anyone at `partner.example` goes to the partner's provider. The broker maps each provider's claims to the application's own (the partner's group `Logistics-Admins` becomes the role `shipment-admin`), so the application sees one issuer and one claim format. |
| **4 · Accounts end at the source** | The partner disables Bo in its own directory, so his next sign-in fails at the partner's provider. Existing sessions end when their tokens expire or when the provider signals a logout, and with **SCIM** provisioning the application's local profile is removed as well. The trust itself needs care: when a provider rotates its signing key, the broker must pick the new key up from the metadata, or every sign-in through that provider fails. |
<!-- END GENERATED: header -->

## The problem

When every application keeps its own accounts, every application is a small identity provider. It stores password hashes, fends off credential stuffing, and runs lockouts, password resets and multi-factor enrolment. Users juggle one more password per application. People who don't work for you, such as a partner's staff or your customers, need accounts that someone creates and, more importantly, someone removes. That is where it breaks: when someone leaves the partner company, their employer disables them in its own directory, but nobody tells your application. The account here becomes an **orphan** that their old password still opens.

## How it works

Federation separates *who is this?* from *what may they do here?* The application stops authenticating people and trusts an identity provider to do it.

- **Identity provider (IdP):** the system that holds a person's account and authenticates them: a company directory, a partner's directory, a social login. OpenID Connect calls it the OpenID Provider.
- **Relying party (RP):** the application that accepts the IdP's statement about the user. SAML calls it the **service provider (SP)**.
- **Claims:** what the token says about the user: a subject identifier, name and email, group memberships, how and when they authenticated. OpenID Connect carries them in a signed **ID token**; SAML calls them attributes and carries them in a signed **assertion**.
- **Trust:** the relying party's configuration of which issuer it believes, which keys that issuer signs with, and that tokens must be addressed to this relying party. It is set up once by exchanging **metadata** (issuer identifier, endpoints, signing keys), published as an OpenID Connect discovery document plus its JWKS, or as a SAML metadata file with the signing certificates.
- **Federation:** the arrangement as a whole: identity providers and relying parties, often in different organisations, that agree to rely on each other's assertions under shared rules.
- **Home realm discovery (HRD):** working out which IdP a user belongs to. The usual signals are the email domain the user types, the subdomain or link they came from, a hint the application passes, or a cookie that remembers the last choice. When nothing matches, the user picks from a list.

At sign-in the relying party redirects the browser to the user's IdP. The IdP authenticates the user under its own policies (password, passkey, MFA) and returns a signed ID token or assertion. The relying party verifies the signature with the IdP's published keys, checks the issuer, the audience, the expiry and, in OpenID Connect, the nonce, and then starts its own session. [OpenID Connect](../openid-connect/) walks through that exchange, and [JWT Validation](../jwt-validation/) covers the key handling.

**Protocols.** OpenID Connect, an identity layer on OAuth 2.0 with JSON tokens, is the usual choice for new applications, including mobile and single-page ones. SAML 2.0, with XML assertions usually posted through the browser, is still common in enterprise SaaS, and most IdPs speak both; its flow is the subject of the [SAML 2.0 Single Sign-On](../saml-sso/) pattern. WS-Federation is an older protocol that Microsoft Entra ID still accepts. Use it only for legacy applications that can do nothing else.

**A federation broker** sits between the application and many IdPs. NIST SP 800-63C-4 calls it a federation proxy: it is a relying party towards each upstream IdP and an identity provider towards the application, and the assertions it issues name the broker as the issuer. The application keeps one trust, one protocol and one claim format, while the broker handles home realm discovery, protocol translation (SAML in, OpenID Connect out), claims mapping, and a separate trust with each upstream provider. Examples as of 2026:

- **An enterprise identity platform**, such as Microsoft Entra ID, whose B2B collaboration lets partner staff sign in with their own organisation's accounts, or Okta, which sends users to external IdPs through routing rules.
- **A customer identity service**, such as Microsoft Entra External ID, Auth0 or Amazon Cognito user pools. Cognito, for example, federates Google, Apple, Facebook, Amazon and any OIDC or SAML provider, and hands the backend one kind of user pool token.
- **An open-source broker** such as Keycloak, whose identity brokering covers OIDC, SAML and social providers, with mappers for claims and organizations that route users by email domain.

**What the application still owns.** Federation hands over authentication, not everything else:

- **Authorization.** The IdP says who the user is and perhaps which groups they belong to; the application decides what that allows. Map external groups to your own roles at the broker or at sign-in, and keep the decisions in the application (or in a policy engine: see [Policy-Based Authorization](../policy-based-authorization/)).
- **Its local profile.** A record keyed on the federated identifier, holding what only the application knows: settings, roles, what the user owns.
- **Its session.** After validating the token the application runs its own session, and the token's lifetime is not the session's. [Sessions vs Tokens](../sessions-vs-tokens/) compares the options.

## When to use it

- **Workforce applications:** employees sign in with the company's IdP, get single sign-on, and lose access when IT disables them in one place.
- **Business to business:** partner staff use their own organisation's accounts, and the partner runs its own joiners and leavers.
- **Multi-tenant SaaS:** each business customer brings its own IdP, while individual users sign in with social or local accounts at a customer identity service.
- **Any application that would otherwise store passwords.**

When **not** to federate:

- **Service-to-service calls.** There is no user to send anywhere. Workloads get tokens of their own, for example with [OAuth 2.0 Client Credentials](../oauth2-client-credentials/), and carry a user's context downstream with [Token Exchange](../token-exchange/).
- **A small, closed group of users of a single application**, where running trust relationships costs more than it saves. Even then, use a managed identity service rather than writing your own password store.
- **A single IdP** needs no broker: trust it directly, and add a broker when the second or third provider arrives.

## Trade-offs

- **A critical dependency.** If the IdP or the broker is down, nobody can sign in, although existing sessions carry on. Give the broker the same availability as the application, ideally in the same regions.
- **Trust is a security boundary.** Any IdP you trust can sign in anyone it is allowed to assert. Scope each provider to the users and tenants it owns, and treat changes to federation settings like changes to firewall rules.
- **Two copies of identity.** A broker usually keeps its own record of each user (Keycloak creates one on first sign-in), so deprovisioning has to reach the broker as well as the application.
- **Sessions in three places.** The IdP, the broker and the application each run a session, and ending one doesn't end the others.
- **Claims are a snapshot.** Group changes and disabled accounts show up at the next sign-in or when the provider sends a signal, not instantly.
- **Less control over sign-in.** Password rules and MFA are the partner's choice. You can require evidence of them, but you don't run them.

## Implementation notes

- **Key users on issuer plus subject, never on email.** OpenID Connect Core §5.7 says `iss` and `sub` together are the only identifier guaranteed to be stable and unique, and that an issuer may let an email address change or give it to someone else. NIST SP 800-63C-4 also builds the federated identifier from the issuer and the subject. In 2023 Microsoft warned that multi-tenant applications using the `email` claim for authorization could be fooled by a user who sets someone else's address as an unverified email; it now leaves such claims out for most applications, and [its guidance](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation) is never to authorise on `email`, `preferred_username` or `unique_name`. Addresses also change hands outside your control: when a company lets its domain lapse, whoever registers it can recreate its mailboxes.
- **Link accounts deliberately.** Don't merge a federated sign-in into an existing account just because the emails match; make the user prove control of both. A 2022 study found 35 of 75 popular services open to [account pre-hijacking](https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan), including attacks that abuse this kind of merge.
- **Just-in-time or SCIM provisioning.** Just-in-time provisioning creates the local profile at first sign-in from the claims. It is simple, but the application never hears about leavers: NIST SP 800-63C-4 warns that such accounts pile up unless the IdP signals terminations, and suggests expiring accounts after a period without use (its example is 120 days for an application used weekly). With SCIM (RFC 7643 defines the schema, RFC 7644 the protocol), the IdP's provisioning service pushes users and groups to the application's `/Users` and `/Groups` endpoints, and deactivates (`active: false`) or deletes them, so a leaver's profile goes even if they never sign in again. Roles can be assigned before the first sign-in, too.
- **Single logout has limits.** OpenID Connect Back-Channel Logout has the IdP send a signed logout token to each relying party, server to server. SAML Single Logout can run over SOAP, but it often relies on the browser visiting every participant in turn, and a participant that doesn't answer leaves sessions behind. Keep application sessions short and renew them silently against the IdP. Where your providers support them, the OpenID Shared Signals specifications (CAEP and RISC, final since September 2025) let them tell you about revoked sessions and disabled accounts.
- **Key rollover and metadata.** IdPs rotate signing keys on a schedule and, in an emergency, at once; Microsoft promises no fixed interval. Load keys from metadata (the OpenID Connect `jwks_uri`, a SAML metadata URL), refresh them periodically and whenever a token arrives with an unknown key ID, and never paste certificates in by hand. In Keycloak, *Use JWKS URL* (OIDC) and *Use metadata descriptor URL* (SAML) do this; with them off, an administrator must import each new key, or sign-ins fail.
- **Multi-tenant SaaS.** Keep a connection per business customer: its issuer, its metadata URL, the email domains used for discovery (once the customer has proved it owns them) and its claim mappings. Validate the issuer per tenant: a token is good only from the issuer configured for that tenant, and only for that tenant's users. With Microsoft Entra ID's multi-tenant endpoints the issuer names the user's own tenant; Microsoft says to check that it contains the token's tenant ID (`tid`) and matches the issuer in the metadata, and you should also accept only tenants you have onboarded.
- **Social login caveats.** A social account tells you who someone is, not where they work: no groups and no leaver process. Check `email_verified`, expect relay addresses (Sign in with Apple can hide the real address behind a random one), and key on `sub`, which Google, for example, documents as never changing. Some social logins are plain OAuth 2.0 with a profile API rather than OpenID Connect. People also lose their social accounts, so plan a recovery path.
- **MFA at the provider, and its strength.** Let the IdP run MFA, then check how the user authenticated: OpenID Connect's `acr` (authentication context class) and `amr` (methods, with values such as `pwd`, `otp` and `mfa` registered by [RFC 8176](https://www.rfc-editor.org/rfc/rfc8176)), or SAML's `AuthnContextClassRef`. A broker must pass these through or map them, not drop them. For sensitive actions, step up: ask for a stronger `acr_values` or a recent `max_age`, and let APIs demand it with the `insufficient_user_authentication` challenge from [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470). Microsoft Entra's cross-tenant access settings can trust the MFA that a partner's own Entra tenant performed.
- **Federation at scale.** NIST SP 800-63C-4 (July 2025) defines three federation assurance levels (FAL1 to FAL3), trust agreements, proxies, provisioning models (just-in-time, pre-provisioning, ephemeral) and shared signaling. OpenID Federation 1.0, a final specification since February 2026, spares parties the pairwise metadata exchange: each entity publishes signed statements, and a trust chain leads from it to a trust anchor that both sides accept. The specification's own examples include research and education federations such as eduGAIN.
- **Zero trust.** Federation gives every request an identity vouched for by the right authority; [Zero Trust Access](../zero-trust-access/) adds device and context checks on every request.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [SAML 2.0 Single Sign-On](../saml-sso/) — Enterprise SSO: the identity provider posts a signed assertion to the app through the browser.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [Policy-Based Authorization](../policy-based-authorization/) — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).

## Related components and services

- [Keycloak](../keycloak/) — An open-source identity provider: user sign-in, federation and single sign-on, issuing OpenID Connect and SAML tokens.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Amazon Cognito](../amazon-cognito/) — Sign-up and sign-in for your app's users: user pools issue OpenID Connect tokens, identity pools trade them for AWS credentials.

## References

- [Azure Architecture Center — Federated Identity pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/federated-identity)
- [OpenID Connect Core 1.0 incorporating errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)
- [OASIS — Security Assertion Markup Language (SAML) V2.0 Technical Overview](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html)
- [NIST SP 800-63C-4 — Digital Identity Guidelines: Federation and Assertions (2025)](https://csrc.nist.gov/pubs/sp/800/63/c/4/final)
- [RFC 7643 — System for Cross-domain Identity Management: Core Schema](https://www.rfc-editor.org/rfc/rfc7643)
- [RFC 7644 — System for Cross-domain Identity Management: Protocol](https://www.rfc-editor.org/rfc/rfc7644)
- [OpenID Connect Back-Channel Logout 1.0 incorporating errata set 1](https://openid.net/specs/openid-connect-backchannel-1_0.html)
- [OpenID Federation 1.0 (Final Specification, 2026)](https://openid.net/specs/openid-federation-1_0.html)
- [Microsoft Entra External ID — What is B2B collaboration?](https://learn.microsoft.com/en-us/entra/external-id/what-is-b2b)
- [Keycloak Server Administration Guide — Integrating identity providers](https://www.keycloak.org/docs/latest/server_admin/index.html#_identity_broker)
- [Auth0 Docs — Configure Identifier First Authentication (home realm discovery)](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)
- [MSRC — Potential Risk of Privilege Escalation in Azure AD Applications (email claims)](https://www.microsoft.com/en-us/msrc/blog/2023/06/potential-risk-of-privilege-escalation-in-azure-ad-applications)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
