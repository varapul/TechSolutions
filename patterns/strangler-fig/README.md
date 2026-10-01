<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔄 Migration & Modernization](../../README.md#migration--modernization)

# Strangler Fig

> Put a facade in front of the legacy system and move routes to new services one at a time.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Strangler Fig" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/strangler-fig.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Add a facade** | Place a **facade** (an API gateway, reverse proxy or routing layer) in front of the legacy system. Clients now talk to the facade, which forwards every route to the monolith unchanged. Nothing has migrated yet, but you now control where each request goes. |
| **2 · Extract /catalog** | Pick one capability with clear boundaries, rebuild it as a new service, and **flip its route** in the facade. The matching code in the monolith stops receiving traffic from the facade and can be deleted later, once calls to it from other legacy modules are redirected to the new service too. |
| **3 · Peel off more** | Repeat, one route at a time, in whatever order delivers value or reduces risk. Each step is small and reversible: if the new service misbehaves, flip the route back to legacy. |
| **4 · Retire the monolith** | When the last route has moved, the monolith serves nothing and can be switched off. The new system has grown around the old one and replaced it, like the strangler fig vine the pattern is named after. |
<!-- END GENERATED: header -->

## The problem

A legacy system is too important to switch off and too costly to keep changing. A big-bang rewrite looks tempting, but it means months or years with no new value, two systems to keep in sync, and one terrifying cut-over day at the end. Many rewrites never reach that day.

## How it works

1. **Intercept.** Put a facade in front of the legacy system so that every request passes through something you control.
2. **Replace one slice.** Build the new implementation of a single capability, usually one route or one bounded context.
3. **Redirect.** Change the facade's routing so that slice goes to the new implementation, and redirect calls to it from other legacy modules as well. Legacy code for it then goes dark.
4. **Repeat, then retire.** Keep going until nothing is routed to the old system, then decommission it.

The migration becomes a long series of small, reversible releases instead of one irreversible leap.

## When to use it

- Replacing or re-platforming a large system that must stay in service throughout.
- When the system can be intercepted at a boundary: HTTP routes, message topics, a UI shell, file drops.
- When you want to deliver new value during the migration rather than only at the end.

## Trade-offs

- **Shared data is the hard part.** Routes are easy to move, but new services and the monolith often share a database for a while. Plan data ownership, synchronization (for example CDC) and eventual cut-over explicitly.
- **The facade is critical infrastructure.** It must be highly available and fast, and must not grow business logic of its own.
- **Two worlds for a while.** Expect duplicated concerns (auth, logging, deployment) until the migration ends. Keep momentum so "temporary" doesn't become permanent.
- **Not every system can be sliced.** Tightly coupled batch jobs or UIs without seams may need branch by abstraction or a parallel run instead.

## Implementation notes

- The facade is often something you already run: an API gateway, an ingress controller, a CDN or load balancer with path-based routing, or a BFF.
- Put an **anti-corruption layer** between new services and legacy models so the old domain model doesn't leak into the new code.
- Use **feature flags** or weighted routing to move a route gradually (1% → 10% → 100%), and **shadow traffic** or a parallel run to compare results before switching.
- Track progress visibly: routes migrated, traffic share on legacy, modules deleted.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- Branch by Abstraction *(planned)* — Introduce an abstraction, build the new implementation behind it, then switch over.
- Parallel Run *(planned)* — Run old and new side by side on the same inputs and compare results before cutting over.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Expand and Contract](../expand-and-contract/) — Change a schema or API in backward-compatible steps: expand, migrate, then contract.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.

## References

- [Martin Fowler — Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [Azure Architecture Center — Strangler Fig pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [AWS Prescriptive Guidance — Strangler fig pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)
- [Sam Newman — Monolith to Microservices](https://samnewman.io/books/monolith-to-microservices/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
