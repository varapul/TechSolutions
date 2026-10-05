<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Chain of Responsibility

> Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Chain of Responsibility" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/chain-of-responsibility.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The sender decides** | `ExpenseService.submit(e)` holds an `if … else if` ladder over the amount and calls `teamLead`, `manager`, `director` or `cfo` itself, so it knows every approver and every limit: EUR 4,200 goes straight to the manager. When a reorganisation adds a **VP** level (up to EUR 200,000), the ladder gets another branch, and the sender is edited and tested again although the expenses it sends haven't changed. |
| **2 · Link the handlers** | The approvers become one chain. Each is a *ConcreteHandler* that extends **Approver** (the *Handler*), which holds a `next` reference and implements `handle(e)`: approve if `canApprove(e)`, otherwise return `next.handle(e)`. The chain is wired once, outside the sender (`teamLead.setNext(manager)` …), and **ExpenseService** (the *Client*) keeps only `first` and sends every expense there. |
| **3 · Pass it on until handled** | Every expense enters at TeamLead and travels along the `next` references until a link can approve it. **EUR 300** stops at TeamLead after 1 hop, **EUR 4,200** passes TeamLead and stops at Manager after 2, and **EUR 18,000** passes two links and stops at Director after 3. `handle()` returns who approved and after how many hops, and the log records both, so it is always clear which link handled what. |
| **4 · Relink, don't edit** | The reorganisation is one changed reference: Director's `next` now points to the new **VP** (up to EUR 200,000), whose `next` is CFO, so EUR 120,000 stops at VP after 4 hops and `ExpenseService` is untouched. **CFO** approves whatever reaches it, the default at the end; without one, an expense nobody takes falls off the chain. The same idea runs DOM event bubbling, middleware in Express and ASP.NET Core (where each link acts and then calls `next`), Servlet filter chains and Python's logger hierarchy. |
<!-- END GENERATED: header -->

## The problem

An expense needs approval, and who may approve it depends on the amount: a team lead up to EUR 500, a manager up to EUR 5,000, a director up to EUR 50,000 and the CFO above that. The first version usually puts this knowledge in the code that sends the request. `ExpenseService.submit()` holds a reference to every approver and an `if … else if` ladder over the amount, and calls the right approver itself.

That works until the organisation changes. A new VP level, a different limit in one department or a temporary rule (the CFO is away, so the director signs everything) are all edits to the sender, which has to be changed and tested again although the expenses it sends are the same. The knowledge of who is responsible for what is split between the approvers, which know how to approve, and the sender, which knows when each of them should. And the sender can't be reused by a team whose approval line looks different.

## How it works

Chain of Responsibility lines up the objects that might handle a request and gives the request to the first of them. Each one either deals with it or hands it to the next, so the sender talks to a single object and never learns which one acted. Who handles what is then decided by the handlers themselves and by the order they are linked in, and both can change without touching the sender. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), whose example is context-sensitive help in a user interface: a help request starts at the widget the user points at and moves out through the dialog to the application until one of them has help to show.

| Participant | In the diagram | Role |
|---|---|---|
| **Handler** | `Approver` | Declares `handle(e)` and holds the link to the next handler. By default it passes the request on. |
| **ConcreteHandler** | `TeamLead`, `Manager`, `Director`, `CFO`, `VP` | Handles the requests it is responsible for, here the amounts within its limit, and passes the rest to its successor. |
| **Client** | `ExpenseService` | Sends every request to the first handler, without knowing how long the chain is or who is in it. |

In the code below, `Approver.handle()` does the forwarding once for every approver, and each subclass only says what it can approve, in `canApprove(e)`. The book's own sample code divides the work slightly differently: each concrete handler overrides the handling method and, when a request isn't its job, calls the inherited version, which forwards it. Either way, a handler sees only its own rule and its `next`.

**Two styles of chain.** The book's form stops at the first handler that takes the request: one approver signs an expense, or none does. A second form is at least as common today: every handler does some work and then passes the request on, and any of them may end it early. Web middleware works this way.

- In [Express](https://expressjs.com/en/guide/using-middleware/), a middleware function receives the request, the response and a `next` function. It can run any code and change the request or the response, and then it either finishes the response or calls `next()`; if it does neither, the request never completes.
- In [ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/), each middleware decides whether to invoke the next one and can do work both before and after it. One that doesn't invoke it is called *terminal* and short-circuits the pipeline, as the static-file middleware does for a file it serves.

The structure is the same in both styles. What differs is whether passing the request on is the exception or the rule.

**Building the chain.** The order of the links is the order in which handlers are asked, so building the chain is configuration, and it belongs in one place: a composition root, a builder or a configuration file, never the sender. Frameworks make the order explicit. Express runs middleware in the order it was [registered](https://expressjs.com/en/guide/writing-middleware/), so a logger registered after a route never sees the requests that the route answers. ASP.NET Core invokes middleware in the order it appears in the app's `Program` file, and runs the response side in the reverse order. A `setNext()` that returns its argument, as below, lets a short chain be written in one line: `director.setNext(vp).setNext(cfo)`.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node expenses.ts`): it strips the types without checking them, so run `tsc --noEmit` as well. `this.constructor.name` gives each approver's class name for the result; code that goes through a minifier should store an explicit name instead, because minifiers can rename classes.

```ts
// Amounts are whole euros.
type Expense = { readonly amount: number };
type Result = { readonly approvedBy: string | null; readonly hops: number };

// Handler: holds the next link and passes on what this link can't approve.
abstract class Approver {
  private next: Approver | null = null;
  setNext(next: Approver): Approver {
    this.next = next;
    return next; // so links can be chained: a.setNext(b).setNext(c)
  }

  handle(e: Expense): Result {
    if (this.canApprove(e)) return { approvedBy: this.constructor.name, hops: 1 };
    if (this.next === null) return { approvedBy: null, hops: 1 }; // fell off the end
    const r = this.next.handle(e);
    return { approvedBy: r.approvedBy, hops: r.hops + 1 };
  }

  protected abstract canApprove(e: Expense): boolean;
}

// ConcreteHandlers: each one knows only its own rule.
class TeamLead extends Approver { protected canApprove(e: Expense) { return e.amount <= 500; } }
class Manager extends Approver { protected canApprove(e: Expense) { return e.amount <= 5_000; } }
class Director extends Approver { protected canApprove(e: Expense) { return e.amount <= 50_000; } }
class CFO extends Approver { protected canApprove(_e: Expense) { return true; } } // the default

// Client: knows only the first link.
class ExpenseService {
  private readonly first: Approver;
  constructor(first: Approver) { this.first = first; }
  submit(e: Expense): Result { return this.first.handle(e); }
}

// The chain is wired once, outside ExpenseService.
const teamLead = new TeamLead(), manager = new Manager();
const director = new Director(), cfo = new CFO();
teamLead.setNext(manager);
manager.setNext(director);
director.setNext(cfo);
const service = new ExpenseService(teamLead);

console.log(service.submit({ amount: 300 }));     // { approvedBy: 'TeamLead', hops: 1 }
console.log(service.submit({ amount: 4_200 }));   // { approvedBy: 'Manager', hops: 2 }
console.log(service.submit({ amount: 18_000 }));  // { approvedBy: 'Director', hops: 3 }

// The reorganisation: a VP between Director and CFO. ExpenseService is untouched.
class VP extends Approver { protected canApprove(e: Expense) { return e.amount <= 200_000; } }
director.setNext(new VP()).setNext(cfo);
console.log(service.submit({ amount: 120_000 })); // { approvedBy: 'VP', hops: 4 }
console.log(service.submit({ amount: 300_000 })); // { approvedBy: 'CFO', hops: 5 }

// Without a default at the end, an expense can fall off the chain.
const noDefault = new TeamLead();
noDefault.setNext(new Manager()).setNext(new Director());
console.log(new ExpenseService(noDefault).submit({ amount: 80_000 })); // { approvedBy: null, hops: 3 }
```

Output:

```
{ approvedBy: 'TeamLead', hops: 1 }
{ approvedBy: 'Manager', hops: 2 }
{ approvedBy: 'Director', hops: 3 }
{ approvedBy: 'VP', hops: 4 }
{ approvedBy: 'CFO', hops: 5 }
{ approvedBy: null, hops: 3 }
```

## When to use it

- Several objects could handle a request, the right one depends on the request and on configuration, and the sender shouldn't have to know which: approvals, support escalation (first line, second line, on call), data sources tried in order, parsers that each recognise one format.
- The handlers, or their order, change more often than the senders do, or differ per tenant, market or deployment.
- Steps that every request passes through (authentication, logging, compression, caching), any of which may answer early. This is the middleware style.
- Not when a request always has one obvious receiver: a direct call is easier to follow.
- Not when the handlers differ only in a number. Four approvers that compare the amount with four limits could be one class and a sorted table of limits. Separate classes pay off when the rules differ in kind, say a CFO who also wants a second signature above some amount, or a compliance check that rejects certain categories outright.
- Not when every receiver must see every request: that is [Observer](../observer/) inside a process, and [publish-subscribe](../publish-subscribe/) between services.

## Trade-offs

- **No handler is guaranteed.** Nothing in the structure makes sure that some handler takes the request, and one that nobody handles falls off the end of the chain. The book lists this among the pattern's consequences. End every chain with a default handler.
- **Who handled it?** The decision is spread over objects linked at runtime, so reading the sender doesn't tell you which handler acted, and a breakpoint in one handler doesn't show why the ones before it passed. Return or log the handler and the hop count, as `handle()` does here.
- **Cost per request.** A request may visit every link before one takes it. The cost grows with the length of the chain, and so does the call stack in the recursive form shown here, one frame per hop. Keep chains short, put the common cases first, or look handlers up by request type once the chain gets long.
- **Order is behaviour.** Swapping two links can change who approves what or let a request skip a check, and a `next` that points back at an earlier link sends an unhandled request round in a circle until the stack overflows. Build chains in one place, and test the assembled chain as well as each handler.
- **In return,** the sender is decoupled from the receivers, handlers can be added, removed and reordered without touching it, and each handler stays small and can be tested alone.

## Implementation notes

- **Unhandled requests and default handlers.** Decide what happens at the end of the chain. Either the last link takes everything, as the CFO does here, or the chain ends with a handler that answers explicitly by rejecting the request, returning a 404 or raising an error. Express recommends exactly this for 404s: a request that no middleware or route answered isn't an error, so the [FAQ](https://expressjs.com/en/starter/faq/) suggests a last middleware at the bottom of the stack that sends the 404. Python's logging module keeps a handler of last resort, [`logging.lastResort`](https://docs.python.org/3/library/logging.html#logging.lastResort), which writes to standard error at level `WARNING` when no handler is found anywhere in the logger hierarchy. Returning `null`, as the chain without a CFO does in the code, is only safe if every caller checks for it.
- **Chains along an existing structure.** The links don't have to be new fields. When the objects already form a tree, the parent reference can serve as `next`, which the book suggests for part-whole hierarchies ([Composite](../composite/)).
  - In the DOM, a click on a button [bubbles](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling) from the innermost element out through its ancestors, and any listener can call [`stopPropagation()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation) to end the trip. That stops the event from reaching other elements, but it doesn't cancel the browser's default action, and other listeners on the same element still run unless [`stopImmediatePropagation()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopImmediatePropagation) is called. Not every event bubbles: [`focus`](https://developer.mozilla.org/en-US/docs/Web/API/Element/focus_event) doesn't, while `focusin` does.
  - Python's loggers form a tree by their dotted names. With [`propagate`](https://docs.python.org/3/library/logging.html#logging.Logger.propagate) true, which is the default, a record logged to `app.db` that passes that logger's level is offered to the handlers of `app.db`, then of `app`, then of the root logger, and the trip ends after the first logger whose `propagate` is false. The ancestors' own levels and filters are skipped; only their handlers are used.
  - Both are the middleware style: every listener or handler on the way gets the event unless one stops it.
- **Servlet filters.** For a request that filters are mapped to, a Jakarta servlet container builds a chain of them in front of the resource. A filter receives the request, the response and a [`FilterChain`](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/filterchain); calling `doFilter()` on it invokes the next filter, or the resource itself after the last one. A [filter](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/filter) that doesn't call it blocks the request, as an authentication filter that answers 401 would, and like middleware it can also work on the response after the rest of the chain has run.
- **Requests as objects.** The book weighs how to represent the request. One method per kind of request is type-safe but fixes the set of requests; a single `handle(request)` that takes an object lets new kinds of request travel the same chain, with each handler checking the kinds it understands. The expense here is such an object. A request object that carries what to do is close to a [Command](../command/), and commands often pass through a chain of handlers (validation, authorisation, logging) before one of them executes the command.
- **Without classes.** With first-class functions, a chain is often a list of functions instead of objects with `next` fields. `approvers.find((a) => a.canApprove(e))` walks the list in order, the position of the match is the hop count, and adding the VP is an insertion into the list. Middleware frameworks pass `next` to each handler as a function argument instead of storing it, so the same handler can sit in several chains.
- **Relinking while requests are in flight.** In a multithreaded server, changing a live chain is a concurrent update. Link the new handler to its successor before you point its predecessor at it, or build a new chain and swap the head reference, so that no request ever reaches a VP that has no `next` yet. The JavaScript example runs synchronously, so its order doesn't matter.
- **Relatives.**
  - [Decorator](../decorator/) has the same shape, a line of objects that each hold the next one, but a decorator normally forwards every call and adds behaviour around it. A handler decides whether to forward at all.
  - [Composite](../composite/) often supplies the links: a node that can't handle a request passes it to its parent.
  - [Command](../command/) is often what travels down the chain.
  - [Observer](../observer/) delivers every notification to every subscriber. A chain offers the request to one handler after another until one takes it.
  - *Mediator* also spares the sender from knowing its receivers, but routes every message through one central object that decides who talks to whom. A chain has no centre: each link knows only the next.
- **At architecture scale.**
  - An [API gateway](../api-gateway/) runs every request through a sequence of policies (authentication, rate limiting, caching, routing), and any one of them can answer on its own: a 401 for a missing token, a 429 for an exhausted quota, a response from the cache. That is the middleware style at the network edge. The order of the policies is configuration, a request that fails one never reaches a service, and the price is the latency every policy adds to every request.
  - [Pipes and Filters](../pipes-and-filters/) also moves data along a line of independent steps, but every filter processes every message that reaches it, and in that diagram the filters are separate services joined by queues. It is a pipeline of transformations, not a search for the one handler that takes the request.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Composite](../composite/) — Treat single objects and groups of objects through one interface, so a whole tree answers a question the way one leaf does.
- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- Mediator *(planned)* — Route the interactions between objects through one mediator, so many-to-many dependencies become one-to-many.
- [Observer](../observer/) — A subject notifies its subscribed observers of every change, so one change updates many dependents it never names.
- [Pipes and Filters](../pipes-and-filters/) — Split processing into independent stages connected by channels.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Chain of Responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)
- [MDN — Event bubbling](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling)
- [MDN — Event: stopPropagation() method](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation)
- [Express — Using middleware](https://expressjs.com/en/guide/using-middleware/)
- [Microsoft Learn — ASP.NET Core middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/)
- [Jakarta Servlet 6.1 API — FilterChain](https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/filterchain)
- [Python documentation — logging (Logger.propagate)](https://docs.python.org/3/library/logging.html#logging.Logger.propagate)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
