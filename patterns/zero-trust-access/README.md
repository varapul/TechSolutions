<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Zero Trust Access

> No implicit trust from network location: verify identity, device and context on every request.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Zero Trust Access" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/zero-trust-access.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The perimeter's flaw** | The classic model checks once, at the edge: a firewall around a flat internal network and a VPN for remote staff. Whatever gets inside is trusted, so one stolen VPN password (or one compromised laptop) reaches the wiki and then moves sideways to the HR application and the production database without being asked anything again. |
| **2 · Verify every request** | The implicit trust is removed. Every resource sits behind its own **policy enforcement point** (PEP), which asks the **policy decision point** before it lets anything through. The decision is made from signals about the request (who is asking and how strongly they signed in, the state of the device, the context, the sensitivity of the resource), not from the network it arrives on. Ana's managed laptop reaches the HR application from home with no VPN: passkey, healthy device, normal context, so the policy engine allows it and the policy administrator tells the PEP to open that one path. |
| **3 · Least privilege** | Access is granted to one resource for one session, never to a network. The same person on an unmanaged tablet may read the wiki but is refused the production database. Workloads are subjects too: `orders-svc` presents its own identity and a rule allows it to use the database, while a compromised `report-job` in the same data centre is refused because no rule names it. Sideways movement stops at the next resource's PEP. |
| **4 · Keep evaluating** | A decision is not permanent. When the laptop misses a security patch, the policy engine revokes the HR session and the PEP cuts it; when the tablet's session suddenly appears from another country, Ana is challenged to sign in again. Every decision lands in the log, which is where misuse is detected and where the evidence for tightening the policy comes from. |
<!-- END GENERATED: header -->

## The problem

The perimeter model answers one question, once: *is this connection coming from inside?* A firewall keeps the outside out, a VPN brings remote staff "in", and behind the wall systems accept each other mostly because of the address a connection comes from. That design fails in three ways.

- **One check, then none.** A stolen VPN password, a phished session or a laptop with malware on it is inside the moment it connects. From there an intruder moves sideways (*lateral movement*): first to something unimportant, then, hop by hop, to something that matters, because nothing inside was built to ask who is calling.
- **There is no inside any more.** People work from home and from phones, applications run as SaaS and in several clouds, and contractors and partners need a slice of access. No single line surrounds all of that. Forcing every connection back through a VPN concentrator to pretend there is one adds latency and gives each connected device a route to far more than it needs.
- **The trust is never examined.** An IP address says nothing about who is at the keyboard, whether the device is patched, or whether this request is unusual for this person. The trust handed out at the edge is *implicit*: nobody decided it for this request on evidence, and nobody takes it back when the evidence changes.

NIST calls the area behind a checkpoint an **implicit trust zone** and compares it to an airport: once through security, everyone in the boarding area is treated as equally trusted. A flat internal network is one very large boarding area. The goal is to shrink that zone as far as it will go, ideally to a single resource.

## How it works

**What the words mean.** *Zero trust* is a way of deciding access in which no request is trusted because of where it comes from: not the office LAN, not the data centre, not the VPN. Every request to every resource is authenticated and authorized on current evidence, and gets the least access that does the job. In NIST's terms, zero trust is the set of ideas and a *zero trust architecture* is one organisation's plan for applying them. It is a strategy and an architecture, not a product: no single purchase delivers it, and most of its parts (an identity provider, device management, gateways, logs) are things an organisation already runs. It does not mean trusting nothing either. Trust is granted all day long. What goes away is trust that is implicit, permanent and derived from network location.

**Where it comes from.**

- **De-perimeterisation.** The Jericho Forum, a group of corporate CISOs that met informally from 2003 and was founded under The Open Group in January 2004, argued that the network perimeter was eroding and that protection had to move to the systems and the data. Its "commandments" (version 1.2 is dated May 2007) already required every device to be able to keep itself secure on an untrusted network.
- **The term.** John Kindervag, then an analyst at Forrester, named the model *zero trust* in a report published on 14 September 2010, *No More Chewy Centers: Introducing the Zero Trust Model of Information Security*.
- **BeyondCorp.** From December 2014 Google described in a series of *;login:* articles how it moved its own staff off the privileged intranet. Internal applications are reached through an internet-facing access proxy, access depends on the user and on a managed device that is recorded in a device inventory and identified by a certificate, office networks become unprivileged, and nobody needs a VPN.
- **NIST SP 800-207** (August 2020) made the model vendor-neutral: seven tenets, and the logical components this diagram uses. SP 800-207A (September 2023) carries it over to cloud-native applications spread over several clouds, with policy written in terms of service identities and not only network addresses. SP 1800-35 (June 2025) documents 19 example implementations that NIST's NCCoE built from commercial products with 24 collaborators.

**The components.** The diagram follows NIST's vocabulary:

- A **subject** asks for access: a person on a device, or a workload.
- A **policy enforcement point (PEP)** stands in the path to a resource. It enables, monitors and ends connections, and passes nothing until it has been told to. It can be one component (a proxy or portal in front of the resource) or two (an agent on the device plus a gateway in front of the resource).
- The **policy decision point (PDP)** has two parts. The **policy engine** takes the decision to grant, deny or revoke access by applying the organisation's policy to the signals it has, and it records that decision. The **policy administrator** carries the decision out: it tells the PEP to set up or shut down the path, and issues whatever session-specific credential the client needs. Products often merge the two.
- PDP and PEP talk over a **control plane** that is separate from the **data plane** carrying application traffic.
- Around them sit the sources the engine reads: the identity system, device management, threat intelligence, activity logs, the PKI and the access policies themselves.

The names PDP and PEP are older than zero trust: NIST takes them from XACML. What is new is where they are put (in front of every resource instead of at one edge) and how often they are asked (on every request).

**The signals.** A decision is only as good as what it is made from:

| Signal | What it answers | Typical sources |
|---|---|---|
| Identity | Who is asking, and how strongly did they prove it? | The identity provider: account, groups and roles, authentication method and how long ago it was used |
| Device | Is this a device we know, and is it in good shape? | Device inventory and management: managed or not, OS and patch level, disk encryption, screen lock, endpoint protection |
| Context | Is this request normal? | Location, time, the network it arrives from (as one input, never as permission), risk scores from sign-in and behaviour analytics, threat intelligence |
| Resource | How much is at stake? | The classification of the application or data, and the action asked for: read, write, administer |

**What gets verified.**

- **Users:** with authentication that a fake sign-in page cannot relay. That means passkeys (FIDO2/WebAuthn) or smart cards, not a password plus a typed code. Sign-in runs through the identity provider with [OpenID Connect](../openid-connect/), and the ID token's `acr` and `amr` claims tell the application how the user authenticated.
- **Devices:** you can only judge a device you know. That takes an inventory, an identity for each device (a certificate whose key sits in a TPM or secure enclave) and posture reported by device management. Personal devices do not have to be locked out. They get less.
- **Workloads:** a service is a subject too, and an address in the data centre is not an identity. Each workload gets its own short-lived credential: a certificate presented in [Mutual TLS](../mutual-tls/), issued and rotated automatically by a [Service Mesh](../service-mesh/) or a workload identity system such as SPIFFE, or an access token from [OAuth 2.0 Client Credentials](../oauth2-client-credentials/).
- **Each request:** the token on every call is checked where it lands ([JWT Validation](../jwt-validation/)), and it should be good for that one API only. A service that calls onwards asks for a new, narrower token for the next hop ([Token Exchange](../token-exchange/)) instead of forwarding the one it received.

**Least privilege, per session.** NIST's third tenet is that access is granted to one resource for one session, and that being let into one resource grants nothing at the next. Policy can also grade access instead of only allowing or denying it: read-only from an unmanaged device, no downloads, a fresh sign-in before an administrative action. *Just-in-time* access applies the same idea to privileges: administrator rights are requested for a task, approved, limited in time and gone afterwards, so there are no standing privileges to steal.

**Where the enforcement point sits.**

- **Identity-aware proxy:** a reverse proxy in front of a web application that authenticates the user and checks device and context before it forwards anything. The application can be published on the internet and is still unreachable without passing the proxy. Google Cloud's Identity-Aware Proxy and AWS Verified Access are examples, and an [API Gateway](../api-gateway/) plays the same role for APIs.
- **Network access broker** (sold as *zero trust network access*, ZTNA): for traffic that is not HTTP, an agent on the device and a connector next to the application set up a connection to that one application after the same checks. It replaces the VPN without handing out a network. Microsoft Entra Private Access is an example.
- **Micro-segmentation:** for traffic between workloads, each resource or small group sits in its own segment behind a gateway, a host firewall or a sidecar proxy that only admits identified, authorized callers.

NIST describes three such approaches (driven by identity governance, by micro-segmentation, and by network infrastructure and software-defined perimeters) and expects a full solution to contain elements of all three.

**Keep evaluating.** A token, once issued, is usually validated offline, so a decision would outlive the signals it was based on. Four techniques shorten that gap, and they combine:

1. **Short-lived tokens.** Keep access tokens to minutes, so that every refresh is a new decision ([Refresh Token Rotation](../refresh-token-rotation/)). The gap is at most the token's lifetime.
2. **Ask every time.** The PEP calls the decision point, or introspects the token (RFC 7662), on each request. There is no gap, at the price of a network call per request.
3. **Push the change.** The system that notices a change tells everyone who relies on the session. The OpenID Shared Signals Framework and the Continuous Access Evaluation Profile (CAEP), both final specifications since September 2025, define this as signed security event tokens (RFC 8417) that a transmitter pushes to a receiver or the receiver polls for, with event types such as session revoked, credential change and device compliance change. Products implemented the idea before the specifications were final. With continuous access evaluation in Microsoft Entra, participating services enforce a disabled account, a password change, revoked refresh tokens, high user risk and location policy in near real time: they reject a token that has not expired with a claims challenge, which sends the client back to the identity provider. In return, tokens in those sessions may live up to 28 hours.
4. **Step up.** Not every doubt needs a hard stop. An API can answer that the authentication behind a token is too weak or too old (RFC 9470, error `insufficient_user_authentication`), and the client sends the user to sign in again. That is what happens to the tablet in step 4.

**One place for policy.** The rules live in a central policy engine instead of being scattered over application code and firewall tables. Written as code (Open Policy Agent's Rego and Cedar are two policy languages), they can be reviewed, tested and versioned like anything else. The OpenID AuthZEN Authorization API 1.0, final since January 2026, standardises the question a PEP asks a PDP. This catalog treats that as a pattern of its own, policy-based authorization.

**Log every decision.** The policy engine records each decision: subject, device, resource, verdict, and the signals behind it. Shipped to [Centralized Logging](../centralized-logging/), those records are how misuse is found (one session seen from two countries, a burst of denials from one workload), how an incident is reconstructed afterwards, and how the policy improves: rules that never match can go, and rules that match everything are too broad.

## When to use it

- **The workforce and the applications are no longer in one place:** remote and hybrid work, SaaS, several clouds.
- **Replacing a VPN** that gives every connected device a route to the whole network.
- **Contractors, partners and personal devices** that need a narrow slice of access and should never see the rest.
- **High-value internal systems:** admin consoles, production data, build and deployment pipelines, where a stolen password must not be enough.
- **Platforms shared by many teams,** where services should not trust each other for sitting on the same cluster or subnet.
- **Gradually.** NIST expects zero trust and perimeter-based workflows to coexist for an indefinite period, and suggests moving one business process at a time.
- **Not for anonymous public traffic.** The model is for people, devices and workloads that the organisation can identify and hold to a policy. A public website still authenticates and authorizes its customers, but it cannot demand a managed device from them.

## Trade-offs

- **The decision and enforcement points become critical dependencies.** If the policy engine or a PEP is down, nothing behind it is reachable, and whoever controls the policy controls all access. They need redundancy, careful change control and an audited emergency path. NIST lists both denial of service and subversion of the decision process among the threats to the architecture.
- **Friction.** More prompts, device enrolment, and a personal tablet that suddenly cannot open something. With too much of it, people route around the controls. Pick sign-in methods that are phishing-resistant and quick, and step up only when the risk or the resource calls for it.
- **Legacy protocols cannot carry identity.** A raw database connection, a file share or an industrial protocol has no place for a token. Such systems have to be wrapped: reached only through a gateway or broker that authenticates first, and segmented tightly behind it.
- **Broad rules bring implicit trust back.** "All employees may reach all internal applications" is a perimeter with extra steps. So is a session that lasts for weeks, a service account shared by ten workloads, or an exception list nobody reviews.
- **Signals can be stale or wrong.** Posture reported an hour ago, a location derived from an IP address behind a shared proxy, or a risk score that cries wolf all produce bad decisions. Policy has to say what happens when a signal is missing.
- **You have to know what you have.** Policy per resource needs an inventory of users, service accounts, devices, applications and the flows between them. For most organisations, building that is the bulk of the work.
- **Network controls are still needed.** Zero trust takes the *trust* out of the network, not the network controls. Segmentation, firewalls, DDoS protection and encryption in transit remain, as one layer among several. NIST's second tenet asks for all communication to be secured wherever it runs.
- **Privacy and lock-in.** Device and behaviour signals are personal data and need limits of their own, and decision points that only speak one vendor's formats are hard to replace.

## Implementation notes

**A migration path that works.**

1. **Inventory.** List the users and service accounts, the devices, the applications and data, and who needs what. NIST's own migration steps start the same way: identify the actors, then the assets, then the business processes.
2. **Strong identity first.** One identity provider, single sign-on, phishing-resistant authentication, devices enrolled in management. Without these the decision point has nothing to decide on.
3. **One application at a time.** Pick an application with a clear owner, put it behind an enforcement point, and run the policy in a log-only mode first (Microsoft Entra Conditional Access calls it report-only) to see who would have been refused. Then enforce it and take the application off the VPN.
4. **Repeat, then go deeper.** More applications, then workload-to-workload traffic with workload identities, then tighter segments as the flat network empties.
5. **Run both models side by side** in the meantime. Identity, device management and logging have to serve the old path and the new one at once.

**Other notes.**

- **Default deny,** with explicit rules per application. Start from the roles and groups you already have and narrow from there.
- **Close the side door.** A PEP protects nothing if the application can still be reached around it. Accept connections only from the proxy, and have the application verify the proxy's signed assertion (Identity-Aware Proxy signs a header for this purpose) instead of trusting a plain header.
- **Decide what a missing signal means.** A device that cannot report its posture is not the same as a healthy one. Fail closed for sensitive resources and be explicit about the rest.
- **Protect the decision point itself:** few administrators, changes reviewed and logged, policy tested before it ships, and break-glass accounts that are watched closely.
- **Match token lifetime to the stakes.** Minutes for sensitive APIs, longer only where revocation events can cut a session early.
- **Measure progress.** CISA's Zero Trust Maturity Model (version 2.0, April 2023) rates five pillars (identity, devices, networks, applications and workloads, data) and three cross-cutting capabilities (visibility and analytics, automation and orchestration, governance) on four stages from traditional to optimal. The UK NCSC's zero trust architecture design principles (reviewed in January 2026) cover the same ground as design advice, and one of them is not to trust any network, your own included. In the United States, OMB memorandum M-22-09 (January 2022) set federal agencies goals under CISA's five pillars for the end of fiscal year 2024, among them phishing-resistant multi-factor authentication for staff, enforced at the application layer instead of the network layer.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- Policy-Based Authorization *(planned)* — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.

## References

- [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)
- [NIST SP 800-207A — A Zero Trust Architecture Model for Access Control in Cloud-Native Applications in Multi-Cloud Environments](https://csrc.nist.gov/pubs/sp/800/207/a/final)
- [NIST SP 1800-35 — Implementing a Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/1800/35/final)
- [CISA — Zero Trust Maturity Model (Version 2.0)](https://www.cisa.gov/zero-trust-maturity-model)
- [UK NCSC — Zero trust architecture design principles](https://www.ncsc.gov.uk/collection/zero-trust/architecture-design-principles)
- [US OMB M-22-09 — Moving the U.S. Government Toward Zero Trust Cybersecurity Principles](https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf)
- [Ward and Beyer — BeyondCorp: A New Approach to Enterprise Security (;login:, December 2014)](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/)
- [Osborn, McWilliams, Beyer and Saltonstall — BeyondCorp: Design to Deployment at Google (;login:, 2016)](https://research.google/pubs/beyondcorp-design-to-deployment-at-google/)
- [Microsoft Entra — Conditional Access: Zero Trust policy engine](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview)
- [Microsoft Entra — Continuous access evaluation](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation)
- [Google Cloud — Identity-Aware Proxy overview](https://docs.cloud.google.com/iap/docs/concepts-overview)
- [OpenID Foundation — Shared Signals Framework Specification 1.0](https://openid.net/specs/openid-sharedsignals-framework-1_0.html)
- [OpenID Foundation — Continuous Access Evaluation Profile 1.0](https://openid.net/specs/openid-caep-1_0.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
