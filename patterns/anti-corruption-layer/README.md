<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Anti-Corruption Layer

> A translation layer that keeps a legacy model from leaking into the new domain.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Anti-Corruption Layer" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/anti-corruption-layer.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The legacy model leaks** | With nothing in between, the new Orders service calls the legacy ERP directly, so it has to speak the ERP's language. Legacy names, codes and formats (`CUST_NO`, `STAT_CD = A`, zero-padded keys) turn up in its code, its model and its own database. The new model is now shaped by the old one, and any change in the ERP can break the new service. |
| **2 · Translate at the boundary** | An **anti-corruption layer** is inserted between the two. Orders asks `getCustomer(42)` in its own language: the **adapter** accepts the call, the **facade** makes the legacy call in the ERP's own terms, and the **translator** maps the reply field by field. A clean `Customer` comes back, and no legacy name crosses into the new model. |
| **3 · Legacy changes stop here** | The ERP changes a code: an active customer is now `STAT_CD = 01` instead of `A`. One mapping row in the translator is updated to match; the Orders service and its model are untouched and keep working. The layer is the only place that knows both models, so it is the only place that has to change. |
| **4 · Keep it thin, then retire** | The price is an extra hop on every call and one more component to run, scale and monitor, so keep the layer thin: translation only, no business rules. In a migration it is temporary: once the customer capability moves to a new Customers service that speaks the new model natively, the layer is retired along with the dependency on the ERP. In front of a third-party or partner system you don't control, it stays for good. |
<!-- END GENERATED: header -->

## The problem

A new service rarely starts alone. It needs data and behaviour that still live in a legacy system, a packaged product or a partner's API, and that system has a model of its own: `CUST_MST` records, `STAT_CD = A`, keys padded with zeros, an interface made of SOAP envelopes or fixed-width files. If the new code calls it directly, that vocabulary moves in. Legacy field names appear in the new service's classes, legacy codes in its `if` statements, legacy formats in its database columns. The new model is now shaped by the old one, the two systems can only change together, and every upgrade on the legacy side is a risk for the new side.

## How it works

The pattern comes from Eric Evans's *Domain-Driven Design* (2003), where it is one of the relationships two **bounded contexts** can have on a context map: a downstream team that needs another system, but not that system's model, builds an isolating layer and talks to the other system only through it. (The name is often shortened to ACL, which has nothing to do with access control lists.)

The layer has three jobs, usually three small parts:

- **Adapter**: implements the interface the new service wants, in the new model's terms (`getCustomer(id)` returns a `Customer`), by making the equivalent requests to the legacy system. It is the only part the new service ever sees, and it offers only what that service needs, not everything the legacy system can do.
- **Translator**: converts what crosses over, in both directions: names (`CUST_NO` becomes `id`), structure (`NM_FRST` and `NM_LAST` become `name`), codes (`STAT_CD = A` becomes `ACTIVE`), formats, units and errors.
- **Facade**: a simpler front for the legacy interface, still in the legacy system's own terms: one plain call instead of a sequence of SOAP envelopes, sessions and paging. It translates nothing, and a legacy system whose interface is already simple doesn't need one.

(Azure and AWS use *facade* and *adapter* more loosely, for the layer as a whole.)

The new service sees only its own model, the legacy system is not modified at all, and the layer is the one place that knows both. When the legacy side changes a code or a format, one mapping changes and the domain does not.

The same idea works in every direction:

- **New calls legacy** (the diagram): the layer stands in front of the legacy system.
- **Legacy calls new**: once a capability has been extracted, the rest of the monolith still calls it the old way. AWS's guidance shows the layer *inside the monolith*, as a class behind the old interface, so the existing callers stay untouched while it translates to the new service's API.
- **Events and data feeds**: a consumer that turns legacy messages, change data capture rows or nightly files into domain events is an anti-corruption layer too. Publish `CustomerActivated`, not a copy of the changed row.

## When to use it

- A migration that takes many releases, during which new services must keep working with the legacy system. It is the usual companion of a [strangler fig](../strangler-fig/).
- Integrating with a third-party, partner or packaged system whose model you don't control and don't want in your code.
- The downstream context is core to the business, so its model is worth protecting.

Evans's context map offers other answers, and they are worth a look before you build a layer:

- **Conformist**: adopt the upstream model as it is, with no translation. It fits when that model is good enough, or the integration is too small to deserve a layer.
- **Open host service with a published language**: the *upstream* side offers one clean, documented API and a shared format to all of its consumers. It fits when you own or can influence the upstream system, or when it has many consumers: fix the model once at the source instead of once per consumer.
- **Separate ways**: don't integrate at all. It fits when the integration would cost more than the feature is worth.

Don't use an anti-corruption layer when the two models are already close (there is nothing to translate, so the layer is only a hop) or when conforming is simply cheaper.

## Trade-offs

- **Latency.** Every call pays for a translation, and for a network hop when the layer is a service of its own. Set a latency budget and test against it before production.
- **One more thing to run.** A separate layer needs its own pipeline, configuration, monitoring and alerting, like any other service.
- **Scaling and availability.** The layer must scale with its callers or it becomes the bottleneck, and when it is down the legacy system is unreachable. Give its calls timeouts, [retries](../retry-with-backoff/) and a [circuit breaker](../circuit-breaker/).
- **Consistency.** Translation does not make two systems consistent. An operation that writes on both sides still needs idempotent calls and compensation (a [saga](../saga-orchestration/)), and someone has to watch for drift.
- **Lossy mappings.** Models never line up perfectly. Decide on purpose what to drop, default or reject, because the layer is where those decisions end up.
- **Temporary tends to become permanent.** If the layer exists only for a migration, record it as debt with an owner and delete it when the last caller has moved.

## Implementation notes

- **Where it lives.** As a module inside the new service: the cheapest option, with no network hop, and fine for a single consumer. As a service of its own (as drawn): when several services need the same legacy capability, or the legacy protocol needs special network placement or runtime. Inside the legacy monolith: when the legacy code is the caller.
- **One layer per upstream context.** A single shared "integration layer" for everything turns into a bottleneck and a dependency of every team. Keep one small layer per upstream system, owned by the team that consumes it.
- **What belongs in it:** translation of names, structures, codes and units; protocol adaptation; mapping of legacy faults to domain errors; validation of what comes back; sometimes a cache for slow or rate-limited lookups. **What doesn't:** business rules and orchestration. A rule that seems to need both models belongs in the domain, working on translated data.
- **Fail loudly on the unknown.** A code the mapping has never seen (`STAT_CD = 07`) should raise an error and an alert, not pass through as a string or fall back to a default.
- **Test the mapping** with recorded legacy responses and with contract tests against the legacy interface, so that a legacy change shows up as a failing test in the layer rather than as bad data in the domain.
- **Observe it.** Carry a correlation ID across the hop ([distributed tracing](../distributed-tracing/)), log translation failures in a structured form, and track latency and error rate per legacy operation.
- **Hexagonal architecture.** In ports-and-adapters terms the domain owns a port in its own language (`CustomerDirectory`), and the anti-corruption layer is the adapter behind it. An ordinary adapter hides a technology; this one also hides a foreign model.
- **Strangler fig.** The strangler facade decides *which system* serves a request; the anti-corruption layer decides *what the data means* when a new service still needs the old one. Migrations usually need both, and the layer goes when the capability behind it has moved.
- **Examples, not requirements:** Azure's example puts Azure API Management in front for exposure and protocol concerns and does the mapping in Azure Functions; AWS's sample keeps the layer as a class in an ASP.NET monolith, which calls the extracted service (a Lambda function) through Amazon API Gateway. For feeds, the same translation runs in a queue or stream consumer.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Branch by Abstraction](../branch-by-abstraction/) — Introduce an abstraction, build the new implementation behind it, then switch over.
- [Parallel Run](../parallel-run/) — Run old and new side by side on the same inputs and compare results before cutting over.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- Database per Service *(planned)* — Each service owns its data; others go through its API or events, never its tables.

## References

- [Eric Evans — Domain-Driven Design: Tackling Complexity in the Heart of Software (2003)](https://www.informit.com/store/domain-driven-design-tackling-complexity-in-the-heart-9780321125217)
- [Eric Evans — Domain-Driven Design Reference](https://www.domainlanguage.com/ddd/reference/)
- [Azure Architecture Center — Anti-Corruption Layer pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
- [AWS Prescriptive Guidance — Anti-corruption layer pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html)
- [Martin Fowler — Bounded Context](https://martinfowler.com/bliki/BoundedContext.html)
- [Sam Newman — Monolith to Microservices](https://samnewman.io/books/monolith-to-microservices/)
- [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
