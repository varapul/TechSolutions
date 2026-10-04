<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# SAML 2.0 Single Sign-On

> Enterprise SSO: the identity provider posts a signed assertion to the app through the browser.

<p align="center"><img src="diagram.svg" alt="Animated diagram: SAML 2.0 Single Sign-On" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/saml-sso.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · SP sends an AuthnRequest** | Ana opens the expense app, which has no session for her. It builds an `<AuthnRequest>` with a fresh `ID` (`id-7f3a`, which it remembers) and its own entity ID as `<Issuer>`, and answers with a redirect to the IdP's SSO URL from the metadata. The **HTTP-Redirect binding** carries the request deflated and base64-encoded in the `SAMLRequest` query parameter, next to a short `RelayState`; the IdP checks that the request comes from a service provider it knows and names an ACS URL registered for it. |
| **2 · IdP posts the assertion** | The IdP authenticates Ana (password, then a second factor) and starts its own SSO session. It answers with a small HTML page whose form the browser submits by itself: the **HTTP-POST binding** carries a base64 `SAMLResponse` and the `RelayState` to the ACS URL. Inside is an assertion signed with the IdP's key that says who signed in (`NameID`), for which app (`Audience`, `Recipient`), when (`NotBefore`, `NotOnOrAfter`), in answer to which request (`InResponseTo`), and with which attributes. It travels through the browser; the two servers never call each other. |
| **3 · Validate, map, then SSO** | Expense verifies the signature with the certificate from the IdP's metadata, then checks the `Issuer`, that the `Audience` is its own entity ID and the `Recipient` its own ACS URL, the time window, that `InResponseTo` is the request it sent, and that it has never seen this assertion `ID`. It maps the `NameID` to its user and the `groups` attribute to a role, and sets its own session cookie. When Ana opens Travel, the IdP finds her SSO session and posts Travel an assertion of its own without asking for a password: **single sign-on**. |
| **4 · IdP-initiated and risks** | Another day, with the app sessions expired, Ana starts at the IdP's portal and clicks the Expense tile. The IdP posts an assertion that nobody requested: it has no `InResponseTo`, so Expense loses the check that ties a response to a request from this browser and has to rely on its replay cache and short lifetimes, which is why some applications refuse or restrict IdP-initiated sign-in. Two more cautions: **signature wrapping** (act only on the assertion the signature covers, through a maintained library) and **certificate rollover** (an SP that has not loaded the IdP's new signing certificate rejects every sign-in). |
<!-- END GENERATED: header -->

## The problem

A company runs dozens of web applications, many of them SaaS: expenses, travel, HR, CRM. If every one keeps its own passwords, each needs its own multi-factor setup and password reset, phishers get dozens of login pages to imitate, and nobody remembers to close a leaver's accounts everywhere. The company wants one place where people sign in, under its own policies, and every application should trust that sign-in without ever seeing a password.

The applications and the identity provider usually belong to different organizations and live on different domains, so they can't share a cookie or a database. They need a standard message that one side can create, the other can verify, and the user's browser can carry between them. SAML 2.0, an OASIS Standard since March 2005, defines that message and the protocol around it, and it is still widely used for enterprise web single sign-on.

## How it works

**The parties.** The *identity provider* (IdP) authenticates the user and vouches for them. The *service provider* (SP) is the application that relies on that statement. Each has an **entity ID**, a URI (typically a URL) that names it uniquely and appears as `Issuer` and `Audience` in messages. Before anyone signs in, the two exchange **metadata**: the SP's entity ID and its **Assertion Consumer Service (ACS) URL**, the endpoint that receives responses; and the IdP's entity ID, its **single sign-on (SSO) URL** and the certificate for the key that signs its assertions.

**The assertion** is the IdP's signed XML statement about the user:

- `Issuer`: the IdP's entity ID.
- `Signature`: an enveloped XML signature with a single reference to the assertion's own `ID` (SAML Core §5.4).
- `Subject`: a `NameID` that identifies the user, plus a *bearer* `SubjectConfirmation` whose data say where the assertion may be delivered (`Recipient`, the ACS URL), until when (`NotOnOrAfter`) and in answer to which request (`InResponseTo`).
- `Conditions`: a validity window (`NotBefore`, `NotOnOrAfter`) and an `AudienceRestriction` that names the SP's entity ID.
- `AuthnStatement`: when and how the user authenticated, and a `SessionIndex` that logout refers to.
- `AttributeStatement`: attributes such as email, display name and group membership.

**NameID formats** (SAML Core §8.3) say what kind of identifier the subject is. A *persistent* identifier is an opaque pseudo-random value that the IdP generates for one service provider or group of them (a pairwise pseudonym of at most 256 characters), so two applications can't link the user through it. A *transient* identifier is temporary and not reused across sign-ins. *emailAddress* is convenient, but addresses change and get reassigned; *unspecified* leaves the choice to the IdP, and X.509 subject names, Windows domain names, Kerberos principals and entity identifiers are defined too. Microsoft Entra ID, for example, [issues a pairwise value](https://learn.microsoft.com/en-us/entra/identity-platform/single-sign-on-saml-protocol) for persistent (and for unspecified) and a random value per sign-in for transient.

**Bindings** describe how a SAML message travels over HTTP (SAML Bindings):

- **HTTP-Redirect** deflates the XML, base64- and URL-encodes it, and puts it in a `SAMLRequest` (or `SAMLResponse`) query parameter. A signature can't stay inside the XML; the sender signs the query string instead and adds `SigAlg` and `Signature` parameters. It suits the small `AuthnRequest`.
- **HTTP-POST** puts the base64 XML in a hidden field of a form that submits itself. Responses use it: the Web Browser SSO profile forbids HTTP-Redirect for them, because a response is typically too long for a URL.
- **HTTP-Artifact** sends only a short reference through the browser; the receiver fetches the message over a back channel (typically SOAP) that must be mutually authenticated. It keeps the assertion out of the browser at the cost of a server-to-server call.

**Profiles** combine messages and bindings for a use case. The **Web Browser SSO profile** (SAML Profiles §4.1) is the flow in the diagram; others cover single logout, enhanced clients and proxies that talk to the IdP themselves (ECP) and artifact resolution.

**SP-initiated sign-in** (steps 1 to 3). Expense creates an `<AuthnRequest>` with a fresh `ID`, its entity ID as `Issuer`, its ACS URL and the binding it wants the answer on, keeps the ID in Ana's session, and redirects her browser to the IdP's SSO URL. The IdP has to check that the ACS URL really belongs to that SP (Profiles §4.1.4.1), or an attacker could have assertions delivered to a URL of their choosing. After authenticating Ana, the IdP returns a page that posts the `SAMLResponse` to the ACS URL. Expense validates it, maps the user and sets its own session cookie. When Travel sends Ana to the IdP later, the IdP's own session cookie spares her a second login: that is the single sign-on.

**IdP-initiated sign-in** (step 4). The profile also lets the IdP send an *unsolicited* response, for example when a user clicks an app tile on the IdP's portal (Profiles §4.1.5). It must not carry `InResponseTo`, it normally goes to the SP's default ACS endpoint, and the IdP may add a `RelayState` that, by prior agreement with the SP, names the page to open.

**Validating a response.** SAML Profiles §4.1.4.3 sets the rules and the OWASP SAML Security Cheat Sheet adds the hardening. Your library should do all of it, but you should know what it does:

1. **Parse defensively.** Refuse DTDs and `DOCTYPE` declarations (OWASP's [XXE prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html)), and validate the document against local, trusted copies of the SAML schemas.
2. **Check the response:** a `Success` status; a `Destination` equal to the ACS URL it arrived at (mandatory when the response is signed); and an `InResponseTo` that matches a request this browser session still has outstanding, which you then mark as used.
3. **Verify the signature** with the key from the IdP's metadata, never with a certificate the message brings along in `KeyInfo`. Accept only the algorithms you expect (OWASP asks for RSA-SHA256 or stronger and no SHA-1) and only the enveloped-signature and exclusive canonicalization transforms (Core §5.4.4). Make sure the reference points at the very element you go on to read.
4. **`Issuer`** of the assertion equals the IdP's entity ID.
5. **Subject confirmation:** a bearer `SubjectConfirmationData` whose `Recipient` is your ACS URL, whose `NotOnOrAfter` hasn't passed, and whose `InResponseTo` is your request ID (absent only if you accept unsolicited responses).
6. **Conditions:** `NotBefore` ≤ now < `NotOnOrAfter`, with a small allowance for clock skew; an `Audience` equal to your entity ID; reject any condition you don't understand.
7. **Replay:** remember each accepted assertion `ID` until its `NotOnOrAfter` passes and reject repeats (Profiles §4.1.4.5 requires this for the POST binding).
8. **Read only what was signed:** take `NameID` and attributes from the element the signature covers, located by its position, not by searching the document for the first `<Assertion>` or `NameID`.
9. **Session limits:** if the `AuthnStatement` carries `SessionNotOnOrAfter`, end your session by then, and check the authentication context if the app needs MFA.

It is the same discipline as [JWT validation](../jwt-validation/), plus XML's extra ways to fail.

**Metadata and certificate rollover.** SAML metadata (an `EntityDescriptor` per party) lists the endpoints and their bindings, keys marked for `signing` or `encryption`, and flags such as the IdP's `WantAuthnRequestsSigned` and the SP's `AuthnRequestsSigned` and `WantAssertionsSigned`; `validUntil` and `cacheDuration` bound how long a copy stays good. Signing certificates expire. Microsoft Entra ID, for example, [creates a self-signed certificate](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/tutorial-manage-certificates-for-federated-single-sign-on) valid for three years for each SAML application and emails reminders 60, 30 and 7 days before it expires. A rollover without an outage publishes the new certificate first, lets each SP add it from the metadata as a second trusted key, switches signing to it, and only then retires the old one. Microsoft asks SaaS vendors to read each customer's per-application metadata URL, check it at least every 24 hours and keep a primary and a secondary signing certificate. An SP with a hand-pasted certificate rejects every sign-in from the moment the IdP switches.

## When to use it

- **Enterprise web applications and SaaS** whose users sign in through a corporate IdP. Workforce IdPs such as [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/single-sign-on-saml-protocol) and [Okta](https://developer.okta.com/docs/concepts/saml/) document SAML integration for this.
- **Applications that already speak SAML,** or customers whose IdP offers nothing else. Microsoft's [planning guidance](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/plan-sso-deployment) is to choose OpenID Connect when the application supports it, and SAML for existing applications that don't use OpenID Connect or OAuth.
- **Not for native mobile apps, single-page apps or APIs.** The Web Browser SSO profile hands a server-side web app a signed statement through a browser POST and gives it nothing to call APIs with. [OpenID Connect](../openid-connect/), on top of [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/), covers those cases: a JSON ID token for the app, access tokens for APIs, and an authorization code redeemed over a back channel, so the tokens never sit in a URL or a form. Many IdPs speak both, and a federation broker can speak SAML to a customer's IdP and OpenID Connect to your app (see [Federated Identity](../federated-identity/)).

## Trade-offs

- **XML signatures are easy to get wrong.** Canonicalization, IDs and references leave room for a parser to read something other than what was signed, and the attack history below is long. Use a maintained library and keep it patched.
- **The assertion is a bearer credential in the front channel.** Whoever holds it can present it until it expires, and it passes through the browser, its extensions and anything that logs the traffic. Short lifetimes, the `Recipient`, `Audience` and replay checks, and optionally encryption, limit the damage.
- **Configuration per application.** Every SP and IdP pair exchanges metadata, agrees on a NameID format and attribute names, and has to survive certificate rollovers. Across hundreds of applications that is real operational work.
- **Logout is weak.** Ending one session rarely ends the others reliably (see below).
- **Attributes are a snapshot.** Group membership is what it was at sign-in. A removed group or a disabled account only shows up at the next sign-in, unless you also provision through SCIM or keep sessions short.

## Implementation notes

- **Use a maintained library, or a broker.** Don't write XML signature verification yourself. Libraries with recent releases include [Spring Security's SAML 2.0 support](https://docs.spring.io/spring-security/reference/servlet/saml2/index.html) (Java), Sustainsys.Saml2 (.NET), pysaml2 (Python), node-saml (Node.js), ruby-saml (Ruby) and SimpleSAMLphp (PHP). Alternatively, let an identity broker speak SAML to your customers' IdPs and give your app OpenID Connect.
- **Signed responses or signed assertions.** With the POST binding every assertion must be protected by a signature, either on the assertion itself or on the whole response (SAML 2.0 Errata 05, E26). A response signature also covers `Destination`, `InResponseTo` and the status; an assertion signature stays verifiable if the assertion is later extracted and stored. Microsoft Entra ID [signs the assertion by default](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/certificate-signing-options) for most gallery applications, can sign the response or both instead, and signs with SHA-256 unless an administrator switches an application that only supports SHA-1. Set `WantAssertionsSigned` in your metadata if you require signed assertions, and check that whichever signature you verify covers the data you use.
- **Encrypted assertions.** SAML Bindings advise against the Redirect and POST bindings when the content must not be exposed to the browser. An `EncryptedAssertion` (XML Encryption, with the key from the SP's metadata marked for `encryption`) keeps the attributes away from the browser and its extensions. Decrypt, then validate the signature exactly as before: encryption hides the content but proves nothing about who wrote it. Entra ID's [SAML token encryption](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/howto-saml-token-encryption), a P1 or P2 feature, uses AES-256 and the public key of a certificate you upload. OWASP also suggests dropping the XML Encryption algorithms known to be insecure.
- **RelayState.** It brings the user back to where they started. The binding caps it at 80 bytes, says it should be integrity-protected, and requires the IdP to return it unchanged. Keep the return URL on the server and send an opaque random key. If a portal sends a URL in `RelayState` for IdP-initiated sign-in, accept only URLs on an allowlist, or it becomes an open redirect (OWASP).
- **IdP-initiated sign-in.** An unsolicited response has nothing to match: no request ID, and no evidence that this browser started a sign-in. That removes a defence against replayed or injected assertions and against login CSRF, where an attacker signs the victim in to the attacker's account; OWASP calls the flow less secure by design and [Auth0 recommends against it](https://auth0.com/docs/authenticate/protocols/saml/saml-sso-integrations/identity-provider-initiated-single-sign-on) where SP-initiated is possible. NIST SP 800-63C-4 requires protection against assertion injection from FAL2 up, with the transaction starting at the relying party. The safer pattern is a portal tile that opens the application's login URL, so the application starts an SP-initiated sign-in: Entra ID's My Apps can do that when an application has a [*Sign on URL*](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/validate-saml-single-sign-on-app-gallery), and OpenID Connect defines the same idea as [login initiated by a third party](https://openid.net/specs/openid-connect-core-1_0.html#ThirdPartyInitiatedLogin). If you must accept unsolicited responses, accept them only from IdPs you list, with the replay cache and short lifetimes.
- **The request ID has to survive a cross-site POST.** The response arrives as a top-level POST from the IdP's site, and browsers [don't send `SameSite=Lax` or `Strict` cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) on cross-site POSTs. If the outstanding `AuthnRequest` ID lives in a cookie-backed session, that cookie needs `SameSite=None; Secure`, or `InResponseTo` never matches.
- **Attribute mapping and provisioning.** Key users on the `NameID` from the issuing IdP (preferably persistent), not on an email address, and map groups to your own roles. IdPs name attributes their own way: Entra ID uses URIs such as `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name`, and it [leaves the groups claim out entirely](https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims) when a user is in more than 150 groups. Just-in-time provisioning creates the local user at first sign-in; SCIM ([RFC 7643](https://www.rfc-editor.org/rfc/rfc7643), [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644)) creates users and groups ahead of time and removes leavers. [Federated Identity](../federated-identity/) covers both and the account lifecycle around them.
- **Single logout is unreliable.** The Single Logout profile has the IdP send a `LogoutRequest` (which must be signed on the Redirect and POST bindings) to every SP where the user has a session, identified by `SessionIndex`, either through the browser or over SOAP. Through the browser, one SP that is down or slow breaks the chain with an error page, and the SP that started the logout learns little about what failed; [Shibboleth's notes on SLO](https://shibboleth.atlassian.net/wiki/spaces/CONCEPT/pages/928645229/SLOIssues) conclude that the sensible advice after most failures is to close the browser. Over SOAP the SP never sees the user's cookie, so it must be able to find and end sessions by `NameID` or `SessionIndex`. Keep application sessions short and treat single logout as best effort.
- **Known attack classes.** Each of these is a reason to use a widely used, maintained library, update it promptly, and test it with tampered responses.
  - *Signature wrapping:* the attacker moves the signed assertion aside and puts a forged one where the application looks, so the signature verifies but the application reads the forgery. A 2012 USENIX Security paper found critical wrapping flaws in 11 of 14 major SAML frameworks, Salesforce, Shibboleth and IBM XS40 among them.
  - *XML parser weaknesses:* DTDs enable external entity (XXE) and entity-expansion attacks, so refuse them. Two parsers that disagree are just as dangerous: in March 2025 GitHub Security Lab showed that ruby-saml up to 1.17.0 (CVE-2025-25291 and CVE-2025-25292) used two XML parsers, REXML and Nokogiri, while verifying signatures, and that a document they read differently let anyone holding one valid signature from the IdP sign in as any user. GitLab was affected; ruby-saml 1.18.0 fixed it.
  - *Comments inside `NameID` (2018):* canonicalization usually leaves comments out of what is signed, so an attacker registered as `user@example.com.evil.example` could insert `<!---->` after `user@example.com` without breaking the signature, and libraries that read only the first text node then saw `user@example.com`. CERT/CC VU#475445 (February 2018), reported by Kelby Ludwig of Duo Security, lists affected implementations including python-saml, ruby-saml, saml2-js, OmniAuth-SAML and Shibboleth's OpenSAML C++.
- **What the application still owns.** SAML ends at sign-in. The application runs its own session (cookie flags, idle and absolute timeouts, never beyond `SessionNotOnOrAfter`) and decides authorization itself, treating the mapped roles as input rather than as the decision; see [Sessions vs Tokens](../sessions-vs-tokens/) and the planned Policy-Based Authorization pattern.
- **Testing and troubleshooting.** A browser extension such as [SAML-tracer](https://github.com/simplesamlphp/SAML-tracer) (Firefox and Chrome) decodes every SAML message as it passes. Most failures are mismatched configuration: entity ID, ACS URL, certificate, NameID format or attribute names. Microsoft Entra ID, for example, [reports](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) `AADSTS50011` when the reply (ACS) URL isn't registered and `AADSTS700016` when it can't find the identifier (entity ID). Check the clocks too: Entra ID sets `NotBefore` to the moment of issue and adds no buffer for clock differences, so an SP whose clock runs slightly behind sees assertions that are not valid yet. Keep NTP running and the skew allowance small. Add negative tests: a broken signature, a wrong audience, an expired or replayed assertion, and an unsolicited response if you don't accept them must all be rejected.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [Policy-Based Authorization](../policy-based-authorization/) — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).

## References

- [OASIS — Security Assertion Markup Language (SAML) V2.0 Technical Overview](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html)
- [OASIS — Assertions and Protocols for SAML V2.0 (SAML Core)](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)
- [OASIS — Bindings for SAML V2.0](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)
- [OASIS — Profiles for SAML V2.0](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf)
- [OASIS — Metadata for SAML V2.0](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf)
- [OASIS — SAML Version 2.0 Errata 05](https://docs.oasis-open.org/security/saml/v2.0/errata05/os/saml-v2.0-errata05-os.html)
- [OWASP — SAML Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html)
- [Microsoft Learn — Single sign-on SAML protocol (Microsoft identity platform)](https://learn.microsoft.com/en-us/entra/identity-platform/single-sign-on-saml-protocol)
- [Microsoft Learn — Manage federation certificates in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/tutorial-manage-certificates-for-federated-single-sign-on)
- [Okta Developer — Understanding SAML](https://developer.okta.com/docs/concepts/saml/)
- [NIST SP 800-63C-4 — Digital Identity Guidelines: Federation and Assertions (2025)](https://csrc.nist.gov/pubs/sp/800/63/c/4/final)
- [Somorovsky et al. — On Breaking SAML: Be Whoever You Want to Be (USENIX Security 2012)](https://www.usenix.org/conference/usenixsecurity12/technical-sessions/presentation/somorovsky)
- [CERT/CC VU#475445 — SAML libraries and XML comments in canonicalization (2018)](https://www.kb.cert.org/vuls/id/475445)
- [GitHub Security Lab — Sign in as anyone: bypassing SAML SSO with parser differentials (2025)](https://github.blog/security/sign-in-as-anyone-bypassing-saml-sso-authentication-with-parser-differentials/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
