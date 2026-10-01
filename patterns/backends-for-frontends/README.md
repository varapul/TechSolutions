<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Backends for Frontends (BFF)

> A dedicated backend per client type, shaped for exactly what that UI needs.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Backends for Frontends (BFF)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/backends-for-frontends.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One API for every client** | Web and mobile both call one **general-purpose API**, often run by a separate API team, whose endpoints mirror the services behind it. To build one product page the web app makes **three round trips** in a row, and the mobile app downloads a **200 KB** product resource over a slow network to show a handful of its fields. Every change one client needs has to go through that team and be checked against the other client. |
| **2 · A backend per experience** | Replace it with **one backend per user experience**: a Web BFF and a Mobile BFF. Each is owned by the team that builds that frontend, so the team shapes its API as the screens change and decides when to ship: the web team releases its app and BFF together, and the mobile team can change its BFF without waiting for an app-store release. |
| **3 · Shape the response** | One call to the **Mobile BFF** fans out to Catalog, Reviews and Users in parallel; the BFF merges the answers, drops the fields the screen doesn't show and points images at mobile-sized versions, so the app gets **12 KB in one round trip**. The **Web BFF** calls all four services and returns a richer page model, also in a single round trip. The extra calls now run inside the data centre, next to the services, instead of over the user's network. |
| **4 · No tokens in the browser** | The **Web BFF** runs the authorization code flow (with PKCE) as a **confidential client**, keeps the access and refresh tokens server-side, and gives the browser only an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie. On each call it swaps the cookie for the access token and forwards the request, so script injected into the page finds no token to steal. RFC 10017 strongly recommends this architecture for business apps, sensitive apps and apps that handle personal data. |
<!-- END GENERATED: header -->

## The problem

One general-purpose API rarely fits every client. A phone has a small screen, a slower and often metered network, and a battery to save, so it wants fewer calls and less data. A rich web page is assembled from many fine-grained endpoints, so the browser makes several round trips before it can render. An API that serves the same resources to both makes the phone over-fetch and the browser chatty.

The organisation feels it as well. Every client team needs changes in the same deployable, which is often owned by a separate API team that has to weigh the client teams' priorities against each other, and a change for one client has to be checked against all the others. Browser apps that call OAuth-protected APIs have one more problem: any token the JavaScript holds can be stolen by script injected into the page.

## How it works

Give each user experience its own backend, a **Backend for Frontend**, owned by the team that builds that frontend. The BFF is part of the application that happens to run on the server: it exposes exactly the API its screens need and is released together with them. Its typical jobs:

- **Aggregate.** One client call fans out to several services, in parallel where possible, and the BFF merges the answers into one response. It also decides what happens when an optional part fails: a product page without stock levels beats no page at all.
- **Shape.** Return only the fields the screen shows, in the form it needs: mobile-sized image URLs, a ready-made page model for the web, the paging each client prefers.
- **Translate.** Hide internal protocols and service boundaries behind one stable API per client.
- **Hold the session.** For a browser app the BFF can also be the OAuth client, so tokens never reach JavaScript (see below).

The name comes from SoundCloud, where building every app on the generic public API meant many calls per screen and constant coordination over every endpoint change. Phil Calçado wrote up their approach in 2015, crediting the name to Nick Fisher, SoundCloud's tech lead for web, and Sam Newman's article, which also describes its use at REA, made it widely known. How many BFFs? A rule Newman quotes is **one experience, one BFF**: iOS and Android can share a BFF when their experiences are close and one team owns both, and get their own when they diverge or belong to different teams.

### Keeping tokens out of the browser

RFC 10017, *OAuth 2.0 for Browser-Based Applications* (a Best Current Practice since August 2026), presents three architectures for browser apps in decreasing order of security, and the BFF comes first. Its BFF has three jobs:

1. It is a **confidential OAuth client**: it authenticates to the authorization server and runs the authorization code flow with PKCE, so even a stolen authorization code can't be redeemed without the BFF's credentials.
2. It keeps the **access and refresh tokens in a cookie-based session** and never exposes them to the browser.
3. It **forwards every API call**: it removes the session cookie from the request, attaches the user's access token and sends the request on to the resource server.

The session cookie must be `Secure` and `HttpOnly`, and should be `SameSite=Strict` with `Path=/`, no `Domain` attribute and a name prefix such as `__Host-Http-`, which marks the cookie as set over HTTP and keeps it from being shared with subdomains. Script injected into the page then finds no token to steal, although it can still send requests through the BFF while the page is open, so the usual XSS defences (secure coding, a Content Security Policy) still matter. The RFC strongly recommends this architecture for business applications, sensitive applications and applications that handle personal data.

Native apps follow RFC 8252 instead: the app itself is the OAuth client (a public client, unless it gets a per-instance secret through dynamic registration) and runs the code flow with PKCE through the system browser, then typically sends its own access token to the Mobile BFF.

## When to use it

- Several kinds of clients (web, iOS and Android, partners, TVs) whose screens, networks or release cycles differ, especially in front of many microservices, where most screens need data from several of them.
- Frontend teams that need to change their API as fast as their UI, without queueing behind a central API team.
- Browser apps that call OAuth-protected APIs on behalf of users, particularly with business or personal data: the BFF keeps tokens out of JavaScript.
- Not for a single web client with little to aggregate and no OAuth tokens to keep out of the browser, where a BFF is just one more hop to run; Newman suggests a web-only app needs one only when it has a lot of server-side aggregation to do. The Azure guidance also calls the pattern a poor fit when only one interface uses the backend, or when the interfaces make the same or similar requests.
- If two BFFs keep growing the same code, treat it as a signal: either the experiences are the same and one BFF will do, or the shared logic belongs in a service.

## Trade-offs

- **More to run.** Every BFF is a service with its own pipeline, monitoring, on-call rota and patching, and each request takes one more network hop. Keep BFFs thin, stateless apart from their session store, and horizontally scaled.
- **Duplication.** Similar aggregation code will appear in several BFFs. Newman tolerates that rather than coupling BFFs through a shared library, and extracts a shared service (or pushes the aggregation into a downstream service) when the same logic is about to be written a third time. SoundCloud did exactly that, turning the profile-page assembly duplicated across its BFFs into a UserProfileService.
- **Business logic creep.** Prices, eligibility rules and authorization decisions belong in the domain services. Once they leak into BFFs, web and mobile slowly start to disagree about the same order. A BFF should only hold logic specific to its experience: composition, shaping, protocol translation and session handling.
- **Fan-out failures.** A BFF response depends on every service it calls. Give each downstream call a timeout, decide which parts are optional, and make sure the client can render a partial response.
- **Old app versions.** Mobile apps stay installed for months, so the Mobile BFF has to keep serving older versions: make changes additive or version the endpoints.
- **BFF vs API gateway.** An [API gateway](../api-gateway/) is one shared front door for cross-cutting policy (TLS, authentication, quotas, routing), usually run by a platform team. A BFF is one backend per experience, owned by a frontend team, holding client-specific composition. Chris Richardson describes the BFF as a variation of the gateway pattern, one gateway per kind of client, and the two combine well: the Azure reference example puts a gateway in front of the BFFs to handle authorization, monitoring, caching and routing.
- **BFF vs GraphQL.** GraphQL lets each client select exactly the fields it needs from one schema, which removes much of the over-fetching a BFF would otherwise fix; the Azure guidance notes that with frontend-specific resolvers, separate BFFs may add little. The cost moves elsewhere: the schema becomes a contract shared and governed across teams, and arbitrary queries need demand control such as depth limits, query complexity analysis or trusted documents. A GraphQL server can also be a BFF itself, and GraphQL Federation composes one graph from many services' subgraphs behind a gateway.

## Implementation notes

- **Build it in the frontend team's stack**, often the client's own language (TypeScript for a web team, for example), and deploy it with the client.
- **Fan out in parallel** with a timeout per call, and pass the trace context (W3C `traceparent`) on every downstream call so that one screen shows up as one trace (see [Distributed Tracing](../distributed-tracing/)).
- **Cache aggregated responses carefully.** A reverse proxy in front of a BFF can cache them, but the expiry must be no longer than the freshest piece of data in the response allows.
- **The Web BFF as an OAuth client** (RFC 10017 §6.1, and the [Authorization Code + PKCE](../oauth2-authorization-code-pkce/) flow it runs):
  - Authenticate at the token endpoint with asymmetric credentials where possible (`private_key_jwt` or mutual TLS, as RFC 9700 recommends), and keep access tokens short-lived and narrowly scoped.
  - Choose where the session lives. **Server-side sessions** keep the tokens on the server, as in the diagram, and allow instant revocation, but need sticky sessions, session replication or a shared store; the RFC recommends them only for small-scale deployments for that reason. **Client-side sessions** put the tokens in an encrypted `HttpOnly` cookie that only the BFF can decrypt, so any instance can serve any request, and revoking the tokens ends access.
  - Refresh access tokens inside the BFF, inline when a call needs it, match the session's lifetime to the refresh token's maximum lifetime, and end the session when the refresh token stops working.
  - Defend against CSRF: `SameSite=Strict` is not enough if other apps share the site, so also require a custom request header (cross-origin requests with one need a CORS preflight) or use the framework's anti-forgery tokens.
  - Forward calls only to an allowlist of resource servers and paths, so the BFF can't be tricked into sending a user's token anywhere else.
  - Tell the resource servers about the BFF: every user's calls now come from the BFF's addresses, so rate limits keyed on client IP will misfire.
- **Libraries:** Duende.BFF for ASP.NET Core, Spring Security's OAuth 2.0 client with Spring Cloud Gateway's `TokenRelay` filter, or Curity's token handler pattern, which splits the role into an OAuth agent that issues the cookies and an API gateway plugin that swaps them for access tokens.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- Gateway Aggregation *(planned)* — Fan one client request out to several services and merge the answers into one response.
- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- GraphQL Federation *(planned)* — A router composes one graph from many services' subgraphs and plans each query across them.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- Sessions vs Tokens *(planned)* — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.

## References

- [Sam Newman — Pattern: Backends For Frontends](https://samnewman.io/patterns/architectural/bff/)
- [Azure Architecture Center — Backends for Frontends pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/backends-for-frontends)
- [Phil Calçado — The Back-end for Front-end Pattern (BFF)](https://philcalcado.com/2015/09/18/the_back_end_for_front_end_pattern_bff.html)
- [RFC 10017 — OAuth 2.0 for Browser-Based Applications (§6.1 Backend for Frontend)](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [Chris Richardson (microservices.io) — Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html)
- [GraphQL.org — Security (demand control and trusted documents)](https://graphql.org/learn/security/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
