# Animated Architecture Patterns

Self-explaining, looping diagrams of **architecture styles, cloud design patterns, auth flows, the classic GoF design patterns and the algorithms underneath them**, built for solutions architects and developers who need to show *how* something works, not just *what* it is.

<p align="center"><img src="patterns/circuit-breaker/diagram.svg" alt="Animated diagram: Circuit Breaker" width="100%"></p>

Every diagram is a single, dependency-free SVG file animated with CSS. It plays right here on GitHub (and anywhere else an `<img>` works), follows your light/dark theme, and tells its story in four steps: the caption under the diagram changes with each step.

**▶ [Browse the catalog with the step-by-step player](https://varapul.github.io/TechSolutions/)**: press → to play one step at a time and hold on its last frame, ideal for presenting. You can also replay a step, slow it down, or link straight to one (`…/circuit-breaker.html#step-3`).

<!-- BEGIN GENERATED: catalog (npm run sync; do not edit by hand) -->
## Contents

**118 animated** · 14 planned · 12 categories

| | Category | Animated | What's inside |
|:-:|---|:-:|---|
| 🏛️ | [Application Architecture](#application-architecture) | 10 / 10 | The big-picture shapes: how a system is split into parts and how those parts talk to each other. |
| ☁️ | [Cloud Infrastructure](#cloud-infrastructure) | 9 / 9 | Where workloads run, and how they scale, stay available and recover from disaster. |
| 🔐 | [Identity & Access (Auth)](#identity--access-auth) | 15 / 15 | Authentication and authorization flows: who is calling, and what they are allowed to do. |
| 🚪 | [API & Edge](#api--edge) | 9 / 9 | The front door: how clients reach services, and where cross-cutting concerns live. |
| 📨 | [Messaging & Integration](#messaging--integration) | 12 / 12 | Asynchronous communication, and coordinating work that spans several services. |
| 🗄️ | [Data Management](#data-management) | 9 / 9 | Storing, scaling, caching and synchronising data across services. |
| 🛡️ | [Resilience & Reliability](#resilience--reliability) | 9 / 9 | Keep serving when dependencies are slow, overloaded or down. |
| 🚀 | [Deployment & Release](#deployment--release) | 8 / 8 | Ship changes safely, watch them in production, and roll back fast. |
| 🔄 | [Migration & Modernization](#migration--modernization) | 6 / 6 | Evolve legacy systems step by step, without a big-bang rewrite. |
| 🔭 | [Observability & Operations](#observability--operations) | 4 / 4 | See what the system is doing, and why, when something goes wrong. |
| 🧮 | [Algorithms & Data Structures](#algorithms--data-structures) | 18 / 18 | The must-know fundamentals: how code searches, sorts, recurses and walks graphs, and what each costs as data grows. |
| 🧩 | [Design Patterns (GoF)](#design-patterns-gof) | 9 / 23 | The 23 classic object-oriented patterns from the Gang of Four: how objects are created, composed and made to work together. |

## Application Architecture

🏛️ The big-picture shapes: how a system is split into parts and how those parts talk to each other.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Layered (N-Tier)**](patterns/layered-architecture/) | Presentation, business and data layers; each layer only calls the one directly below it. | ✅ animated |
| [**Modular Monolith**](patterns/modular-monolith/) | One deployable unit built from strongly bounded modules that talk through explicit interfaces. | ✅ animated |
| [**Microservices**](patterns/microservices/) | Small, independently deployable services, each owning one business capability and its data. | ✅ animated |
| [**Event-Driven Architecture**](patterns/event-driven-architecture/) | Producers publish events to a broker; any number of consumers react on their own schedule. | ✅ animated |
| [**Serverless (Functions)**](patterns/serverless/) | Functions start per event, scale out automatically and scale to zero when idle. | ✅ animated |
| [**Hexagonal (Ports & Adapters)**](patterns/hexagonal-architecture/) | Domain logic at the core; UIs, databases and queues plug in through ports and adapters. | ✅ animated |
| [**Web-Queue-Worker**](patterns/web-queue-worker/) | A web front end hands slow work to background workers through a queue. | ✅ animated |
| [**Microkernel (Plug-in)**](patterns/microkernel/) | A minimal core system extended by independent plug-in modules. | ✅ animated |
| [**Space-Based**](patterns/space-based-architecture/) | Processing units share an in-memory data grid, taking the database off the hot path. | ✅ animated |
| [**Cell-Based Architecture**](patterns/cell-based-architecture/) | Many isolated, identical cells behind a thin router contain the blast radius of any failure. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Cloud Infrastructure

☁️ Where workloads run, and how they scale, stay available and recover from disaster.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Multi-Region Active-Active**](patterns/multi-region-active-active/) | Serve users from several regions at once and shift traffic away from a region that fails. | ✅ animated |
| [**Active-Passive Failover**](patterns/active-passive-failover/) | A warm standby region is promoted when the primary region goes down. | ✅ animated |
| [**Disaster Recovery Strategies**](patterns/disaster-recovery-strategies/) | Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO. | ✅ animated |
| [**Autoscaling**](patterns/autoscaling/) | Add and remove instances automatically as load rises and falls. | ✅ animated |
| [**Load Balancing**](patterns/load-balancing/) | Spread requests across healthy instances and stop sending to unhealthy ones. | ✅ animated |
| [**CDN & Edge Caching**](patterns/cdn-edge-caching/) | Serve static content from edge locations close to users; only cache misses reach the origin. | ✅ animated |
| [**Deployment Stamps**](patterns/deployment-stamps/) | Deploy many independent copies of the whole stack, each serving a subset of tenants. | ✅ animated |
| [**Hub-and-Spoke Network**](patterns/hub-spoke-network/) | Shared services and egress in a central hub network; workloads live in peered spokes. | ✅ animated |
| [**Private Endpoints**](patterns/private-endpoints/) | Reach managed cloud services over private IPs instead of the public internet. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Identity & Access (Auth)

🔐 Authentication and authorization flows: who is calling, and what they are allowed to do.

| Pattern | In one line | Status |
|---|---|:-:|
| [**OAuth 2.0 Authorization Code + PKCE**](patterns/oauth2-authorization-code-pkce/) | The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel. | ✅ animated |
| [**OpenID Connect (OIDC)**](patterns/openid-connect/) | An ID token on top of OAuth 2.0 tells the app who signed in. | ✅ animated |
| [**OAuth 2.0 Client Credentials**](patterns/oauth2-client-credentials/) | Machine-to-machine access tokens, with no user involved. | ✅ animated |
| [**JWT Validation**](patterns/jwt-validation/) | APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS). | ✅ animated |
| [**Refresh Token Rotation**](patterns/refresh-token-rotation/) | Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family. | ✅ animated |
| [**Sessions vs Tokens**](patterns/sessions-vs-tokens/) | Server-side sessions versus self-contained tokens: where the state lives and how you revoke it. | ✅ animated |
| [**Token Exchange (On-Behalf-Of)**](patterns/token-exchange/) | Swap an incoming user token for a narrowly scoped one before calling a downstream API. | ✅ animated |
| [**Device Authorization Grant**](patterns/device-authorization-grant/) | Sign in on a TV or CLI by approving a short code on your phone. | ✅ animated |
| [**SAML 2.0 Single Sign-On**](patterns/saml-sso/) | Enterprise SSO: the identity provider posts a signed assertion to the app through the browser. | ✅ animated |
| [**Federated Identity**](patterns/federated-identity/) | Let an external identity provider authenticate users; the application trusts its tokens. | ✅ animated |
| [**Mutual TLS (mTLS)**](patterns/mutual-tls/) | Client and server both present certificates, so every connection is authenticated both ways. | ✅ animated |
| [**Valet Key**](patterns/valet-key/) | Give clients a short-lived, narrowly scoped URL to read or write storage directly. | ✅ animated |
| [**Gatekeeper**](patterns/gatekeeper/) | A hardened broker validates and sanitises requests before they reach trusted hosts. | ✅ animated |
| [**Policy-Based Authorization**](patterns/policy-based-authorization/) | Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC). | ✅ animated |
| [**Zero Trust Access**](patterns/zero-trust-access/) | No implicit trust from network location: verify identity, device and context on every request. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## API & Edge

🚪 The front door: how clients reach services, and where cross-cutting concerns live.

| Pattern | In one line | Status |
|---|---|:-:|
| [**API Gateway**](patterns/api-gateway/) | One entry point that authenticates, rate-limits and routes calls to backend services. | ✅ animated |
| [**Backends for Frontends (BFF)**](patterns/backends-for-frontends/) | A dedicated backend per client type, shaped for exactly what that UI needs. | ✅ animated |
| [**Gateway Aggregation**](patterns/gateway-aggregation/) | Fan one client request out to several services and merge the answers into one response. | ✅ animated |
| [**Gateway Offloading**](patterns/gateway-offloading/) | Move TLS termination, authentication and compression out of every service into the gateway. | ✅ animated |
| [**Sidecar**](patterns/sidecar/) | Run helper capabilities (proxy, logging, config) in a separate process next to the app. | ✅ animated |
| [**Ambassador**](patterns/ambassador/) | An out-of-process proxy that handles outbound connectivity (retries, TLS, routing) for a client. | ✅ animated |
| [**Service Mesh**](patterns/service-mesh/) | Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code. | ✅ animated |
| [**Webhooks**](patterns/webhooks/) | Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency. | ✅ animated |
| [**GraphQL Federation**](patterns/graphql-federation/) | Subgraphs from many services compose into one graph; a router plans each query across them. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Messaging & Integration

📨 Asynchronous communication, and coordinating work that spans several services.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Publish-Subscribe**](patterns/publish-subscribe/) | Broadcast each message to every interested subscriber through a topic. | ✅ animated |
| [**Competing Consumers**](patterns/competing-consumers/) | Several workers pull from one queue, so work is shared and throughput scales out. | ✅ animated |
| [**Queue-Based Load Leveling**](patterns/queue-based-load-leveling/) | A queue absorbs traffic spikes so the backend can work at a steady pace. | ✅ animated |
| [**Priority Queue**](patterns/priority-queue/) | Urgent messages are processed ahead of routine ones. | ✅ animated |
| [**Asynchronous Request-Reply**](patterns/asynchronous-request-reply/) | Accept now with 202, process in the background, and let the client poll a status URL. | ✅ animated |
| [**Transactional Outbox**](patterns/transactional-outbox/) | Save the event in the same database transaction as the data, then relay it: no dual-write gap. | ✅ animated |
| [**Saga (Orchestration)**](patterns/saga-orchestration/) | A coordinator runs local transactions in sequence and triggers compensations when one fails. | ✅ animated |
| [**Saga (Choreography)**](patterns/saga-choreography/) | Services react to each other's events to complete a workflow, with no central coordinator. | ✅ animated |
| [**Dead-Letter Queue**](patterns/dead-letter-queue/) | Park messages that keep failing so they stop blocking the queue and can be inspected. | ✅ animated |
| [**Idempotent Consumer**](patterns/idempotent-consumer/) | Remember processed message IDs so a redelivered message has no extra effect. | ✅ animated |
| [**Claim Check**](patterns/claim-check/) | Put the large payload in storage and send only a reference through the broker. | ✅ animated |
| [**Pipes and Filters**](patterns/pipes-and-filters/) | Split processing into independent stages connected by channels. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Data Management

🗄️ Storing, scaling, caching and synchronising data across services.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Cache-Aside**](patterns/cache-aside/) | Read from the cache first; on a miss load from the database and populate the cache. | ✅ animated |
| [**CQRS**](patterns/cqrs/) | Separate the write model (commands) from read models (queries), each optimised for its job. | ✅ animated |
| [**Event Sourcing**](patterns/event-sourcing/) | Store every change as an immutable event and rebuild state by replaying them. | ✅ animated |
| [**Sharding**](patterns/sharding/) | Split data horizontally across databases using a shard key. | ✅ animated |
| [**Read Replicas**](patterns/read-replicas/) | Send writes to the primary and spread reads across asynchronously updated replicas. | ✅ animated |
| [**Materialized View**](patterns/materialized-view/) | Precompute query-shaped views so reads don't pay for joins and aggregations. | ✅ animated |
| [**Change Data Capture (CDC)**](patterns/change-data-capture/) | Stream every committed change from the database log to other systems. | ✅ animated |
| [**Database per Service**](patterns/database-per-service/) | Each service owns its data; others go through its API or events, never its tables. | ✅ animated |
| [**Medallion Architecture**](patterns/medallion-architecture/) | Bronze, silver, gold: raw data is refined in layers inside a lakehouse. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Resilience & Reliability

🛡️ Keep serving when dependencies are slow, overloaded or down.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Circuit Breaker**](patterns/circuit-breaker/) | Stop calling a failing dependency, fail fast with a fallback, and probe until it recovers. | ✅ animated |
| [**Retry with Backoff & Jitter**](patterns/retry-with-backoff/) | Retry transient failures with growing, randomised delays so clients don't stampede. | ✅ animated |
| [**Bulkhead**](patterns/bulkhead/) | Give each dependency its own pool of resources so one failure can't sink the whole ship. | ✅ animated |
| [**Timeout & Fallback**](patterns/timeout-and-fallback/) | Bound every remote call and degrade gracefully when the time runs out. | ✅ animated |
| [**Rate Limiting & Throttling**](patterns/rate-limiting/) | Cap how fast each client may call (token bucket) and shed the excess with 429s. | ✅ animated |
| [**Health Endpoint Monitoring**](patterns/health-endpoint-monitoring/) | Expose liveness and readiness checks that load balancers and monitors probe. | ✅ animated |
| [**Leader Election**](patterns/leader-election/) | Instances elect one coordinator; another takes over when its lease expires. | ✅ animated |
| [**Compensating Transaction**](patterns/compensating-transaction/) | Undo the completed steps of a multi-step operation that failed part-way. | ✅ animated |
| [**Chaos Engineering**](patterns/chaos-engineering/) | Inject failures on purpose to prove the system degrades the way you expect. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Deployment & Release

🚀 Ship changes safely, watch them in production, and roll back fast.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Blue-Green Deployment**](patterns/blue-green-deployment/) | Run the new version beside the old one and switch all traffic in one step. | ✅ animated |
| [**Canary Release**](patterns/canary-release/) | Route a small slice of traffic to the new version, watch its metrics, then ramp up or roll back. | ✅ animated |
| [**Rolling Update**](patterns/rolling-update/) | Replace instances batch by batch while the service stays up. | ✅ animated |
| [**Feature Flags**](patterns/feature-flags/) | Deploy code dark, then turn features on per user or percentage at runtime. | ✅ animated |
| [**Shadow Traffic**](patterns/shadow-traffic/) | Mirror live requests to the new version and compare results without affecting users. | ✅ animated |
| [**GitOps**](patterns/gitops/) | Git holds the desired state; an agent continuously reconciles the cluster to match it. | ✅ animated |
| [**Immutable Infrastructure**](patterns/immutable-infrastructure/) | Never patch servers in place: bake a new image and replace them. | ✅ animated |
| [**External Configuration Store**](patterns/external-configuration-store/) | Keep configuration out of the deployment package, in a central store read at runtime. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Migration & Modernization

🔄 Evolve legacy systems step by step, without a big-bang rewrite.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Strangler Fig**](patterns/strangler-fig/) | Put a facade in front of the legacy system and move routes to new services one at a time. | ✅ animated |
| [**Anti-Corruption Layer**](patterns/anti-corruption-layer/) | A translation layer that keeps a legacy model from leaking into the new domain. | ✅ animated |
| [**Branch by Abstraction**](patterns/branch-by-abstraction/) | Introduce an abstraction, build the new implementation behind it, then switch over. | ✅ animated |
| [**Parallel Run**](patterns/parallel-run/) | Run old and new side by side on the same inputs and compare results before cutting over. | ✅ animated |
| [**Expand and Contract**](patterns/expand-and-contract/) | Change a schema or API in backward-compatible steps: expand, migrate, then contract. | ✅ animated |
| [**Cloud Migration Strategies (7 Rs)**](patterns/cloud-migration-strategies/) | Rehost, replatform, refactor, repurchase, relocate, retain or retire: pick one per workload. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Observability & Operations

🔭 See what the system is doing, and why, when something goes wrong.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Distributed Tracing**](patterns/distributed-tracing/) | Propagate a trace context across services and assemble the spans into one timeline. | ✅ animated |
| [**Centralized Logging**](patterns/centralized-logging/) | Ship structured logs from every service to one searchable store, correlated by request ID. | ✅ animated |
| [**SLOs & Error Budgets**](patterns/slo-error-budgets/) | Measure SLIs against an objective and alert on error-budget burn rate, not on every blip. | ✅ animated |
| [**Telemetry Pipeline (OpenTelemetry)**](patterns/telemetry-pipeline/) | Receive, process and export traces, metrics and logs through one vendor-neutral collector. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Algorithms & Data Structures

🧮 The must-know fundamentals: how code searches, sorts, recurses and walks graphs, and what each costs as data grows.

| Pattern | In one line | Status |
|---|---|:-:|
| [**Big-O Notation**](patterns/big-o-notation/) | How an algorithm's cost grows with its input: O(1), O(log n), O(n), O(n log n) and O(n²) side by side as n grows. | ✅ animated |
| [**Recursion & the Call Stack**](patterns/recursion/) | A function calls itself on a smaller input; each call waits on the stack until a base case returns and the answers unwind. | ✅ animated |
| [**Binary Search**](patterns/binary-search/) | Halve a sorted range with every check: about 20 steps find one item among a million, where a scan may need a million. | ✅ animated |
| [**Bubble, Selection & Insertion Sort**](patterns/elementary-sorts/) | The three simple O(n²) sorts compared, and why insertion sort still runs inside fast library sorts on short runs. | ✅ animated |
| [**Merge Sort**](patterns/merge-sort/) | Split the list until single items remain, then merge sorted halves back together: O(n log n) every time, and stable. | ✅ animated |
| [**Quicksort**](patterns/quicksort/) | Partition around a pivot, smaller values left and larger right, then sort each side: fast in place, O(n²) when pivots are bad. | ✅ animated |
| [**Binary Heap & Heapsort**](patterns/binary-heap/) | A complete binary tree packed into an array keeps the smallest item on top: O(log n) push and pop, the classic priority queue. | ✅ animated |
| [**Hash Table**](patterns/hash-table/) | Hash each key straight to a bucket for O(1) average lookups; colliding keys share a bucket, and the table grows as it fills. | ✅ animated |
| [**Binary Search Tree**](patterns/binary-search-tree/) | Smaller keys left, larger right: O(log n) search and insert while the tree stays balanced, O(n) once it degrades into a list. | ✅ animated |
| [**Two Pointers**](patterns/two-pointers/) | Move two indices through an array, toward each other or one chasing the other, to solve pair and partition problems in one pass. | ✅ animated |
| [**Sliding Window**](patterns/sliding-window/) | Slide a window along a sequence, adding the item that enters and dropping the one that leaves, instead of re-scanning each window. | ✅ animated |
| [**Breadth-First Search**](patterns/breadth-first-search/) | Explore a graph level by level from a queue; the first time BFS reaches a node, it has found a path with the fewest edges. | ✅ animated |
| [**Depth-First Search**](patterns/depth-first-search/) | Follow one path as deep as it goes, then backtrack; a stack or recursion remembers where to resume, and finds cycles too. | ✅ animated |
| [**Topological Sort**](patterns/topological-sort/) | Order tasks so every dependency comes before what needs it, as build tools and package managers do; a cycle makes it impossible. | ✅ animated |
| [**Dijkstra's Shortest Path**](patterns/dijkstra/) | Settle the closest unsettled node, relax its edges, repeat: shortest paths from one source when no edge weight is negative. | ✅ animated |
| [**Greedy Algorithms**](patterns/greedy-algorithms/) | Take the choice that looks best right now and never revisit it: optimal for some problems, quietly wrong for others. | ✅ animated |
| [**Dynamic Programming**](patterns/dynamic-programming/) | Solve each overlapping subproblem once and reuse its answer, top-down with memoization or bottom-up with a table. | ✅ animated |
| [**Backtracking**](patterns/backtracking/) | Build a solution one choice at a time and undo any choice that hits a dead end: N-Queens, sudoku, permutations. | ✅ animated |

<sub>[↑ Back to contents](#contents)</sub>

## Design Patterns (GoF)

🧩 The 23 classic object-oriented patterns from the Gang of Four: how objects are created, composed and made to work together.

| Pattern | In one line | Status |
|---|---|:-:|
| Abstract Factory | Create families of related objects through one interface, so swapping the whole family never touches client code. | ⏳ planned |
| [**Builder**](patterns/builder/) | Assemble a complex object step by step and validate it once at the end, instead of calling a constructor with ten arguments. | ✅ animated |
| [**Factory Method**](patterns/factory-method/) | Let subclasses decide which class to create: the base class codes against an interface and calls an overridable create method. | ✅ animated |
| Prototype | Create new objects by copying a configured prototype instead of building them from scratch, and know when a copy must go deep. | ⏳ planned |
| [**Singleton**](patterns/singleton/) | Guarantee one instance with a global access point, and why injecting one shared instance usually serves that need better. | ✅ animated |
| [**Adapter**](patterns/adapter/) | Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API. | ✅ animated |
| Bridge | Split an abstraction from its implementation so both vary independently: m shapes and n renderers need m + n classes, not m × n. | ⏳ planned |
| Composite | Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does. | ⏳ planned |
| [**Decorator**](patterns/decorator/) | Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination. | ✅ animated |
| [**Facade**](patterns/facade/) | Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes. | ✅ animated |
| Flyweight | Share the common, immutable part of many similar objects and keep only what differs in each one, to cut memory. | ⏳ planned |
| Proxy | Stand in for another object with the same interface to control access to it: lazy loading, caching, access checks, remoting. | ⏳ planned |
| Chain of Responsibility | Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will. | ⏳ planned |
| [**Command**](patterns/command/) | Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts. | ✅ animated |
| Interpreter | Represent a small language's grammar as classes and evaluate a sentence by walking its syntax tree. | ⏳ planned |
| Iterator | Walk a collection one element at a time without exposing how it is stored: an array, a tree or a stream that never ends. | ⏳ planned |
| Mediator | Route the interactions between objects through one mediator, so many-to-many dependencies become one-to-many. | ⏳ planned |
| Memento | Capture an object's state in a snapshot only it can read, so it can be restored later without breaking encapsulation. | ⏳ planned |
| [**Observer**](patterns/observer/) | A subject notifies its subscribed observers of every change, so one change updates many dependents it never names. | ✅ animated |
| State | Let an object change its behaviour when its state changes by delegating to state objects instead of growing switch statements. | ⏳ planned |
| [**Strategy**](patterns/strategy/) | Put interchangeable algorithms behind one interface and choose one at runtime, instead of branching inside the caller. | ✅ animated |
| Template Method | Fix an algorithm's skeleton in a base class and let subclasses fill in individual steps, without changing their order. | ⏳ planned |
| Visitor | Add new operations to a stable set of classes without editing them: each operation is a visitor that every element accepts. | ⏳ planned |

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

Each `patterns/<slug>/diagram.svg` is self-contained: no scripts, fonts or external files. Put it in a README, a wiki or a browser-based deck (reveal.js, Slidev) as an image and it animates on its own. PowerPoint shows SVGs without animation and Google Slides doesn't accept them, so present from the step-by-step player instead:

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
