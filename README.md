# Animated Architecture Patterns

Self-explaining, looping diagrams of **architecture styles, cloud design patterns and auth flows**, built for solutions architects who need to show *how* something works, not just *what* it is.

<p align="center"><img src="patterns/circuit-breaker/diagram.svg" alt="Animated diagram: Circuit Breaker" width="100%"></p>

Every diagram is a single, dependency-free SVG file animated with CSS. It plays right here on GitHub (and anywhere else an `<img>` works), follows your light/dark theme, and tells its story in four steps: the caption under the diagram changes with each step.

**▶ [Browse the catalog with the step-by-step player](https://varapul.github.io/TechSolutions/)**: pause, loop a single step, or slow it down.

<!-- BEGIN GENERATED: catalog (npm run sync; do not edit by hand) -->
## Contents

**10 animated** · 81 planned · 10 categories

| | Category | Animated | What's inside |
|:-:|---|:-:|---|
| 🏛️ | [Application Architecture](#application-architecture) | 1 / 10 | The big-picture shapes: how a system is split into parts and how those parts talk to each other. |
| ☁️ | [Cloud Infrastructure](#cloud-infrastructure) | 1 / 9 | Where workloads run, and how they scale, stay available and recover from disaster. |
| 🔐 | [Identity & Access (Auth)](#identity--access-auth) | 1 / 15 | Authentication and authorization flows: who is calling, and what they are allowed to do. |
| 🚪 | [API & Edge](#api--edge) | 1 / 9 | The front door: how clients reach services, and where cross-cutting concerns live. |
| 📨 | [Messaging & Integration](#messaging--integration) | 1 / 12 | Asynchronous communication, and coordinating work that spans several services. |
| 🗄️ | [Data Management](#data-management) | 1 / 9 | Storing, scaling, caching and synchronising data across services. |
| 🛡️ | [Resilience & Reliability](#resilience--reliability) | 1 / 9 | Keep serving when dependencies are slow, overloaded or down. |
| 🚀 | [Deployment & Release](#deployment--release) | 1 / 8 | Ship changes safely, watch them in production, and roll back fast. |
| 🔄 | [Migration & Modernization](#migration--modernization) | 1 / 6 | Evolve legacy systems step by step, without a big-bang rewrite. |
| 🔭 | [Observability & Operations](#observability--operations) | 1 / 4 | See what the system is doing, and why, when something goes wrong. |

## Application Architecture

🏛️ The big-picture shapes: how a system is split into parts and how those parts talk to each other.

| Pattern | In one line | Status |
|---|---|:-:|
| Layered (N-Tier) | Presentation, business and data layers; each layer only calls the one directly below it. | ⏳ planned |
| Modular Monolith | One deployable unit built from strongly bounded modules that talk through explicit interfaces. | ⏳ planned |
| Microservices | Small, independently deployable services, each owning one business capability and its data. | ⏳ planned |
| [**Event-Driven Architecture**](patterns/event-driven-architecture/) | Producers publish events to a broker; any number of consumers react on their own schedule. | ✅ animated |
| Serverless (Functions) | Functions start per event, scale out automatically and scale to zero when idle. | ⏳ planned |
| Hexagonal (Ports & Adapters) | Domain logic at the core; UIs, databases and queues plug in through ports and adapters. | ⏳ planned |
| Web-Queue-Worker | A web front end hands slow work to background workers through a queue. | ⏳ planned |
| Microkernel (Plug-in) | A minimal core system extended by independent plug-in modules. | ⏳ planned |
| Space-Based | Processing units share an in-memory data grid, taking the database off the hot path. | ⏳ planned |
| Cell-Based Architecture | Many isolated, identical cells behind a thin router contain the blast radius of any failure. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Cloud Infrastructure

☁️ Where workloads run, and how they scale, stay available and recover from disaster.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Multi-Region Active-Active**](patterns/multi-region-active-active/) | Serve users from several regions at once and shift traffic away from a region that fails. | ✅ animated |
| Active-Passive Failover | A warm standby region is promoted when the primary region goes down. | ⏳ planned |
| Disaster Recovery Strategies | Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO. | ⏳ planned |
| Autoscaling | Add and remove instances automatically as load rises and falls. | ⏳ planned |
| Load Balancing | Spread requests across healthy instances and stop sending to unhealthy ones. | ⏳ planned |
| CDN & Edge Caching | Serve static content from edge locations close to users; only cache misses reach the origin. | ⏳ planned |
| Deployment Stamps | Deploy many independent copies of the whole stack, each serving a subset of tenants. | ⏳ planned |
| Hub-and-Spoke Network | Shared services and egress in a central hub network; workloads live in peered spokes. | ⏳ planned |
| Private Endpoints | Reach managed cloud services over private IPs instead of the public internet. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Identity & Access (Auth)

🔐 Authentication and authorization flows: who is calling, and what they are allowed to do.

| Pattern | In one line | Status |
|---|---|:-:|
| [**OAuth 2.0 Authorization Code + PKCE**](patterns/oauth2-authorization-code-pkce/) | The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel. | ✅ animated |
| OpenID Connect (OIDC) | An ID token on top of OAuth 2.0 tells the app who signed in. | ⏳ planned |
| OAuth 2.0 Client Credentials | Machine-to-machine access tokens, with no user involved. | ⏳ planned |
| JWT Validation | APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS). | ⏳ planned |
| Refresh Token Rotation | Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family. | ⏳ planned |
| Sessions vs Tokens | Server-side sessions versus self-contained tokens: where the state lives and how you revoke it. | ⏳ planned |
| Token Exchange (On-Behalf-Of) | Swap an incoming user token for a narrowly scoped one before calling a downstream API. | ⏳ planned |
| Device Authorization Grant | Sign in on a TV or CLI by approving a short code on your phone. | ⏳ planned |
| SAML 2.0 Single Sign-On | Enterprise SSO: the identity provider posts a signed assertion to the app through the browser. | ⏳ planned |
| Federated Identity | Let an external identity provider authenticate users; the application trusts its tokens. | ⏳ planned |
| Mutual TLS (mTLS) | Client and server both present certificates, so every connection is authenticated both ways. | ⏳ planned |
| Valet Key | Give clients a short-lived, narrowly scoped URL to read or write storage directly. | ⏳ planned |
| Gatekeeper | A hardened broker validates and sanitises requests before they reach trusted hosts. | ⏳ planned |
| Policy-Based Authorization | Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC). | ⏳ planned |
| Zero Trust Access | No implicit trust from network location: verify identity, device and context on every request. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## API & Edge

🚪 The front door: how clients reach services, and where cross-cutting concerns live.

| Pattern | In one line | Status |
|---|---|:-:|
| [**API Gateway**](patterns/api-gateway/) | One entry point that authenticates, rate-limits and routes calls to backend services. | ✅ animated |
| Backends for Frontends (BFF) | A dedicated backend per client type, shaped for exactly what that UI needs. | ⏳ planned |
| Gateway Aggregation | Fan one client request out to several services and merge the answers into one response. | ⏳ planned |
| Gateway Offloading | Move TLS termination, authentication and compression out of every service into the gateway. | ⏳ planned |
| Sidecar | Run helper capabilities (proxy, logging, config) in a separate process next to the app. | ⏳ planned |
| Ambassador | An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client. | ⏳ planned |
| Service Mesh | Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code. | ⏳ planned |
| Webhooks | Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency. | ⏳ planned |
| GraphQL Federation | A router composes one graph from many services' subgraphs and plans each query across them. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Messaging & Integration

📨 Asynchronous communication, and coordinating work that spans several services.

| Pattern | In one line | Status |
|---|---|:-:|
| Publish-Subscribe | Broadcast each message to every interested subscriber through a topic. | ⏳ planned |
| Competing Consumers | Several workers pull from one queue, so work is shared and throughput scales out. | ⏳ planned |
| Queue-Based Load Leveling | A queue absorbs traffic spikes so the backend can work at a steady pace. | ⏳ planned |
| Priority Queue | Urgent messages are processed ahead of routine ones. | ⏳ planned |
| Asynchronous Request-Reply | Accept now with 202, process in the background, and let the client poll a status URL. | ⏳ planned |
| Transactional Outbox | Save the event in the same database transaction as the data, then relay it: no dual-write gap. | ⏳ planned |
| [**Saga (Orchestration)**](patterns/saga-orchestration/) | A coordinator runs local transactions in sequence and triggers compensations when one fails. | ✅ animated |
| Saga (Choreography) | Services react to each other's events to complete a workflow, with no central coordinator. | ⏳ planned |
| Dead-Letter Queue | Park messages that keep failing so they stop blocking the queue and can be inspected. | ⏳ planned |
| Idempotent Consumer | Remember processed message IDs so a redelivered message has no extra effect. | ⏳ planned |
| Claim Check | Put the large payload in storage and send only a reference through the broker. | ⏳ planned |
| Pipes and Filters | Split processing into independent stages connected by channels. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Data Management

🗄️ Storing, scaling, caching and synchronising data across services.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Cache-Aside**](patterns/cache-aside/) | Read from the cache first; on a miss load from the database and populate the cache. | ✅ animated |
| CQRS | Separate the write model (commands) from read models (queries), each optimised for its job. | ⏳ planned |
| Event Sourcing | Store every change as an immutable event and rebuild state by replaying them. | ⏳ planned |
| Sharding | Split data horizontally across databases using a shard key. | ⏳ planned |
| Read Replicas | Send writes to the primary and spread reads across asynchronously updated replicas. | ⏳ planned |
| Materialized View | Precompute query-shaped views so reads don't pay for joins and aggregations. | ⏳ planned |
| Change Data Capture (CDC) | Stream every committed change from the database log to other systems. | ⏳ planned |
| Database per Service | Each service owns its data; others go through its API or events, never its tables. | ⏳ planned |
| Medallion Architecture | Bronze, silver, gold: raw data is refined in layers inside a lakehouse. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Resilience & Reliability

🛡️ Keep serving when dependencies are slow, overloaded or down.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Circuit Breaker**](patterns/circuit-breaker/) | Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers. | ✅ animated |
| Retry with Backoff & Jitter | Retry transient failures with growing, randomised delays so clients don't stampede. | ⏳ planned |
| Bulkhead | Give each dependency its own pool of resources so one failure can't sink the whole ship. | ⏳ planned |
| Timeout & Fallback | Bound every remote call and degrade gracefully when the time runs out. | ⏳ planned |
| Rate Limiting & Throttling | Cap how fast each client may call (token bucket) and shed the excess with 429s. | ⏳ planned |
| Health Endpoint Monitoring | Expose liveness and readiness checks that load balancers and monitors probe. | ⏳ planned |
| Leader Election | Instances elect one coordinator; another takes over when its lease expires. | ⏳ planned |
| Compensating Transaction | Undo the completed steps of a multi-step operation that failed part-way. | ⏳ planned |
| Chaos Engineering | Inject failures on purpose to prove the system degrades the way you expect. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Deployment & Release

🚀 Ship changes safely, watch them in production, and roll back fast.

| Pattern | In one line | Status |
|---|---|:-:|
| Blue-Green Deployment | Run the new version beside the old one and switch all traffic in one step. | ⏳ planned |
| [**Canary Release**](patterns/canary-release/) | Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back. | ✅ animated |
| Rolling Update | Replace instances batch by batch while the service stays up. | ⏳ planned |
| Feature Flags | Deploy code dark, then turn features on per user or percentage at runtime. | ⏳ planned |
| Shadow Traffic | Mirror live requests to the new version and compare results without affecting users. | ⏳ planned |
| GitOps | Git holds the desired state; an agent continuously reconciles the cluster to match it. | ⏳ planned |
| Immutable Infrastructure | Never patch servers in place: bake a new image and replace them. | ⏳ planned |
| External Configuration Store | Keep configuration out of the deployment package, in a central store read at runtime. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Migration & Modernization

🔄 Evolve legacy systems step by step, without a big-bang rewrite.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Strangler Fig**](patterns/strangler-fig/) | Put a facade in front of the legacy system and move routes to new services one at a time. | ✅ animated |
| Anti-Corruption Layer | A translation layer that keeps a legacy model from leaking into the new domain. | ⏳ planned |
| Branch by Abstraction | Introduce an abstraction, build the new implementation behind it, then switch over. | ⏳ planned |
| Parallel Run | Run old and new side by side on the same inputs and compare results before cutting over. | ⏳ planned |
| Expand and Contract | Change a schema or API in backward-compatible steps: expand, migrate, then contract. | ⏳ planned |
| Cloud Migration Strategies (7 Rs) | Rehost, replatform, refactor, repurchase, relocate, retain or retire: pick one per workload. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>

## Observability & Operations

🔭 See what the system is doing, and why, when something goes wrong.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Distributed Tracing**](patterns/distributed-tracing/) | Propagate a trace context across services and assemble the spans into one timeline. | ✅ animated |
| Centralized Logging | Ship structured logs from every service to one searchable store, correlated by request ID. | ⏳ planned |
| SLOs & Error Budgets | Measure SLIs against an objective and alert on error-budget burn rate, not on every blip. | ⏳ planned |
| Telemetry Pipeline (OpenTelemetry) | Receive, process and export traces, metrics and logs through one vendor-neutral collector. | ⏳ planned |

<sub>[↑ Back to contents](#contents)</sub>
<!-- END GENERATED: catalog -->

## How to read the diagrams

| | Meaning |
|---|---|
| 🔵 Blue dots | Requests and calls |
| 🟢 Green | Success, healthy, or the new system |
| 🔴 Red | Failures and errors |
| 🟡 Amber | Degraded, waiting, retrying or falling back |
| 🟪 Purple squares | Events and messages |
| Dashed outline | A boundary, such as a broker, a network or a region |

The bar under each diagram shows which of the four steps is playing.

## Use a diagram

Each `patterns/<slug>/diagram.svg` is self-contained: no scripts, fonts or external files. Drop it into a README, wiki or slide as an image and it animates on its own:

```md
![Circuit Breaker](patterns/circuit-breaker/diagram.svg)
```

## Run the site locally

```sh
npm install
npm run build      # writes dist/
open dist/index.html
```

The site is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`.

## Contributing

The table of contents above is generated from [`catalog.json`](catalog.json). To animate a planned pattern, see [CONTRIBUTING.md](CONTRIBUTING.md). It covers the canvas, the 20-second timeline, the colour language and the `npm run snap` preview tool.
