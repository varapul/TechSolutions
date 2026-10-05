<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Mediator

> Route the interactions between objects through one mediator, so many-to-many dependencies become one-to-many.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Mediator" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/mediator.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Everyone talks to everyone** | Without a mediator the widgets call each other: when the country changes, `CountrySelect` calls `postcode.setFormat()`, `shipping.reload()` and `pay.disable()`, `PostcodeField` calls `pay.enable()` once the postcode is valid, and `ShippingOptions` disables Pay while it reloads. Wired to each other, four widgets hold 4 × 3 = **12 references**, and the rule for Pay is spread over three classes. A fifth widget, a gift-wrap checkbox, makes it 5 × 4 = 20 and adds a field to all four classes. |
| **2 · Talk to the mediator** | Each widget (a *Colleague*) now holds one reference, to the `Mediator` interface, and only reports what happened: `mediator.notify(this, 'changed')`. `CheckoutMediator` (the *ConcreteMediator*) holds the four widgets and the rules, and calls the right ones. The mesh collapses into a star: 12 references become 4 (with 10 widgets, 90 become 10), and a gift-wrap checkbox now costs one reference and one new rule in `CheckoutMediator`, with no other widget edited. |
| **3 · One change, coordinated** | The user picks **Thailand**: `CountrySelect` notifies the mediator, whose country rule calls `postcode.setFormat('5 digits')`, `shipping.reload('TH')` and `pay.disable()`, in that order. The user types **10110**: `PostcodeField` notifies, the mediator checks it against the 5-digit format and calls `pay.enable()`. Notifications come in (purple) and calls go out (blue); no widget calls another. |
| **4 · Costs, and cousins** | The mediator concentrates the interaction logic, so every new rule lands in `CheckoutMediator` and it can grow into a god object: split it by area (address, payment) and keep the widgets dumb. Unlike [Observer](../observer/), where each listener decides for itself, a mediator owns the rules, though it is often built on notifications; unlike [Facade](../facade/), whose subsystem never knows it exists, colleagues know and call their mediator. At system scale a [saga orchestrator](../saga-orchestration/) coordinates services the way a mediator coordinates widgets, [choreography](../saga-choreography/) is the mesh, and a [hub-and-spoke network](../hub-spoke-network/) replaces a full mesh of peerings with one hub. |
<!-- END GENERATED: header -->

## The problem

A checkout form has four widgets that depend on each other. Choosing a country sets the postcode format, changes which shipping options exist and means the customer can't pay yet; a valid postcode lets them pay. The first version usually wires the widgets to each other: `CountrySelect` keeps the postcode field, the shipping options and the Pay button and calls all three when it changes, `PostcodeField` enables Pay when its value is valid, and `ShippingOptions` disables Pay while it reloads.

Each call makes sense where it is written, but together they tie every widget to the others. When each of n widgets can reach all the others, the form holds n(n − 1) references: 12 for four widgets, 20 for five, 90 for ten. Real forms rarely use every pair, but the costs show up long before that:

- **The rules have no home.** Whether Pay is enabled is decided in three classes, so nobody can read the rule in one place, and changing it means finding every call.
- **The widgets can't be reused.** A `PostcodeField` that calls `pay.enable()` only works on a page that has that Pay button.
- **Every new widget edits old ones.** A gift-wrap checkbox has to reach, and be reached by, the widgets it affects, so adding it means opening classes that already work.

## How it works

Mediator takes the interactions out of the objects and gives them to one object that sits between them. Each widget, a *colleague*, keeps a single reference, to its mediator, and tells it when something has happened to it. The mediator knows every colleague and holds the rules: when it hears that the country changed, it decides which widgets have to react and calls them. Colleagues never call each other, so the many-to-many web becomes one-to-many. The pattern is one of the behavioural patterns in *Design Patterns* by Gamma, Helm, Johnson and Vlissides (1994), whose own example is a dialog box whose widgets are coordinated by a director object.

| Participant | In the diagram | Role |
|---|---|---|
| **Mediator** | `Mediator` | The interface colleagues talk to; here one method, `notify(sender, event)`. |
| **ConcreteMediator** | `CheckoutMediator` | Knows the four widgets and holds the rules between them: what happens when the country or the postcode changes. |
| **Colleague** | `CountrySelect`, `PostcodeField`, `ShippingOptions`, `PayButton` | Knows only its mediator. It reports what happened and carries out what the mediator asks, and never calls another colleague. |

**The arithmetic.** Wired directly, each of n widgets holds a reference to each of the other n − 1, so n(n − 1) in all, which grows with the square of the form. With a mediator each widget holds one, so n in all: 4 instead of 12 here, and 10 instead of 90 for ten widgets. The mediator holds one reference back to each widget, so counting both directions the star has 2n references, 20 against 90 for ten widgets. A fifth widget adds 8 references to the mesh of four (20 − 12) but one to the star, two with the mediator's.

The colleagues become simple: a widget knows how to show a value, change its format or reload its options, and nothing about checkout rules. Because the rules sit in one class, they can be read, changed and tested together. The book also notes that the abstract `Mediator` can be left out when the colleagues only ever work with one mediator; keep the interface when the same widgets appear in other forms with other rules, or to test a widget against a fake mediator.

## Code

TypeScript that mirrors the diagram. Node 22.18 or later runs it as is (`node checkout.ts`) by stripping the types; `tsc --noEmit --strict` type-checks it. `CheckoutMediator` creates the four widgets and hands each of them itself, so no widget is ever given another one. `type()` sets the whole value at once; a real field that listens for `input` events would notify on every keystroke, and the mediator would keep Pay disabled until the fifth digit, which is what the `'1011'` assert checks.

```ts
import assert from 'node:assert/strict';

// Mediator: the one object every widget knows.
interface Mediator {
  notify(sender: Widget, event: string): void;
}

// Colleague: tells its mediator what happened and never calls another widget.
abstract class Widget {
  protected readonly mediator: Mediator;
  constructor(mediator: Mediator) { this.mediator = mediator; }
  protected changed(): void { this.mediator.notify(this, 'changed'); }
}
class CountrySelect extends Widget {
  value = '';
  choose(code: string): void { this.value = code; this.changed(); }
}
class PostcodeField extends Widget {
  value = '';
  hint = '';
  setFormat(hint: string): void { this.hint = hint; this.value = ''; }
  type(text: string): void { this.value = text; this.changed(); }
}
class ShippingOptions extends Widget {
  options: string[] = [];
  reload(country: string): void { this.options = OPTIONS[country] ?? []; }
}
class PayButton extends Widget {
  enabled = false;
  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; }
}

const FORMATS: Record<string, { hint: string; pattern: RegExp }> = {
  TH: { hint: '5 digits', pattern: /^\d{5}$/ },
};
const OPTIONS: Record<string, string[]> = { TH: ['Standard · 3–5 days', 'Express · 1–2 days'] };

// ConcreteMediator: creates the four widgets and holds every rule between them.
class CheckoutMediator implements Mediator {
  readonly country = new CountrySelect(this);
  readonly postcode = new PostcodeField(this);
  readonly shipping = new ShippingOptions(this);
  readonly pay = new PayButton(this);

  notify(sender: Widget, event: string): void {
    if (event !== 'changed') return;
    const format = FORMATS[this.country.value];
    if (sender === this.country) {
      this.postcode.setFormat(format?.hint ?? '');
      this.shipping.reload(this.country.value);
      this.pay.disable();                          // until the postcode is valid
    } else if (sender === this.postcode) {
      if (format?.pattern.test(this.postcode.value)) this.pay.enable();
      else this.pay.disable();
    }
  }
}

const { country, postcode, shipping, pay } = new CheckoutMediator();
country.choose('TH');                              // the user picks Thailand
assert.deepEqual([postcode.hint, shipping.options.length, pay.enabled], ['5 digits', 2, false]);
postcode.type('1011');                             // four digits: Pay stays disabled
assert.equal(pay.enabled, false);
postcode.type('10110');                            // five digits: the mediator enables Pay
assert.equal(pay.enabled, true);
// No widget holds another widget: its one reference is the mediator.
for (const widget of [country, postcode, shipping, pay]) {
  assert.ok(Object.values(widget).every((field) => !(field instanceof Widget)));
}
console.log(postcode.hint, '|', shipping.options.join(', '), '|', pay.enabled);
```

Output:

```
5 digits | Standard · 3–5 days, Express · 1–2 days | true
```

## When to use it

- A group of objects whose interactions are the hard part: forms and dialogs whose fields enable, fill and check each other, editor panels that react to the current selection, the steps of a wizard, the units in a game scene.
- Rules that span several objects (Pay depends on the country and the postcode) and change often: one class is where to change and test them.
- Objects you want to reuse in another context, which they can't be while they hold their neighbours.
- Not for two objects with one simple interaction, where a direct call is clearer, and not for a one-way broadcast in which each listener decides for itself what to do: that is [Observer](../observer/).

## Trade-offs

- **It centralises control.** The complexity of the interactions doesn't go away; it moves into the mediator. Every new rule lands in the same class, so a checkout mediator can grow into a god object that knows everything about the page. The book warns that the mediator itself can turn into a large class that is hard to maintain.
- **Indirection.** Reading `CountrySelect` no longer tells you what changing the country does; you have to read the mediator. In return there is exactly one place to read.
- **The mediator is the least reusable part.** The colleagues become reusable because the page-specific logic leaves them, and all of it lands in the mediator, which fits only this form.
- **In return,** colleagues are simple and decoupled, a new widget edits only the mediator, and the interaction rules can be tested in one place.

## Implementation notes

- **How colleagues talk to the mediator.**
  - *A call that names the sender.* The widget calls `mediator.notify(this, 'changed')` and the mediator compares the sender with the colleagues it holds, as here. The book's sample code works this way: a widget passes itself to its director when it changes. A typed alternative gives the mediator one method per event, such as `countryChanged(code)` and `postcodeChanged(value)`: clearer, and checked by the compiler, but the interface grows with every event.
  - *Events.* The colleagues publish events and the mediator subscribes to them, which is Observer used as plumbing; the book names this as another way to connect colleagues to their mediator. The widgets then don't even know who listens. In a browser, the [`input` and `change` events bubble](https://html.spec.whatwg.org/multipage/input.html#common-input-element-events), so one listener on the `<form>` hears every field and can run the rules.
  - *Callbacks.* Where functions are values, a widget can take a callback such as `onChange` instead of a reference to a mediator type, and the rules live in the object that created the widgets. React's [lifting state up](https://react.dev/learn/sharing-state-between-components) has this shape: the closest common parent owns the shared state, passes values down as props and gets changes back through event-handler props, so the parent form component is the mediator and the controlled inputs are its colleagues.
- **Test the rules in one place.** Because the rules live in `CheckoutMediator`, a test can drive the widgets and check what the mediator did, as the asserts above do, without a browser. A widget can be tested on its own against a fake mediator that records the `notify()` calls it receives.
- **Keep it from becoming a god object.**
  - Keep the widgets dumb: they report what happened and offer operations, and any rule that involves another widget goes to a mediator.
  - Keep the mediator to coordination: postcode formats, prices and API calls belong in their own classes, which the mediator calls.
  - Split it by area as it grows: an address mediator for country, postcode and shipping, a payment mediator for Pay, promo codes and saved cards. Where two areas meet (Pay needs a valid address), let one mediator publish an event or expose a state that the other listens to, instead of merging them back into one.
- **Relatives.** The book's discussion of behavioural patterns treats Mediator, Observer, Chain of Responsibility and Command as four ways to decouple the objects that send requests from the objects that act on them:
  - [Observer](../observer/) is a one-to-many broadcast: a subject notifies whoever subscribed and each observer decides what to do, so the logic is spread over the observers. A mediator centralises it: one object decides who does what. The two combine well, with the colleagues as subjects and the mediator as their observer.
  - [Facade](../facade/) also puts one object in front of several, but its protocol runs one way: clients call the facade, the facade calls the subsystem, and the subsystem's classes don't know it exists. Colleagues know their mediator, call it and are called back by it.
  - [Chain of Responsibility](../chain-of-responsibility/) passes a request along a chain until one handler takes it. It has no centre, and each link knows only the next.
  - [Command](../command/) turns a request into an object that links one sender to one receiver: the sender holds the command, and the command knows its receiver. In-process "mediator" libraries such as MediatR dispatch request objects much like these, as the next point shows.
- **Mediator libraries.** [MediatR](https://github.com/LuckyPennySoftware/MediatR) for .NET describes itself as a simple mediator implementation: in-process messaging in which a request sent with `Send` reaches exactly one handler and a notification sent with `Publish` reaches every matching handler, one after another by default. Pipeline behaviors wrap the handling of a request for cross-cutting concerns such as logging and validation. What it decouples is the code that sends a message, a web controller for example, from the class that handles it, which makes it closer to a command dispatcher than to the book's mediator, where one object holds the rules among a group of peers. Since version 13.0, MediatR has been a commercial product of Lucky Penny Software that asks for a license key, with a free community edition for smaller organisations ([mediatr.io](https://mediatr.io/)); earlier versions stay under their open-source license.
- **At architecture scale.** The same choice between a mesh and a hub appears between services and between networks:
  - A [saga orchestrator](../saga-orchestration/) is a mediator for services: one coordinator tells each participant which local transaction to run and decides what comes next, including compensations. [Choreography](../saga-choreography/) is the mesh: each service reacts to the others' events, and the flow exists only as the sum of their subscriptions. Azure's [Saga pattern guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga) weighs them the way this page weighs the widgets: choreography suits simple flows with few services and has no central point of failure, but it gets hard to follow as steps are added and risks cyclic dependencies between services; orchestration suits complex flows and keeps each one in one place, at the cost of coordination logic to build and one more component that can fail.
  - A [hub-and-spoke network](../hub-spoke-network/) replaces peering every network with every other by one hub that each spoke peers with. A full mesh of ten networks needs 45 peerings, n(n − 1)/2 because one peering connects two networks; ten spokes need ten. Traffic between spokes passes through the hub's firewall or router, so policy lives in one place at the cost of an extra hop, and Azure's [hub-spoke reference architecture](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke) still suggests direct peering between spokes of the same workload that need low latency.
  - What changes at that scale: the mediator is a separate process that has to be deployed, scaled and kept available, its calls cross a network and can time out, and its state, such as how far a saga has got, has to survive a restart.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Observer](../observer/) — A subject notifies its subscribed observers of every change, so one change updates many dependents it never names.
- [Facade](../facade/) — Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.
- [Chain of Responsibility](../chain-of-responsibility/) — Pass a request along a chain of handlers until one handles it, so the sender never needs to know which one will.
- [Command](../command/) — Turn a request into an object that can be queued, logged, undone and redone, decoupling who asks from who acts.
- [Saga (Orchestration)](../saga-orchestration/) — A coordinator runs local transactions in sequence and triggers compensations when one fails.
- [Saga (Choreography)](../saga-choreography/) — Services react to each other's events to complete a workflow, with no central coordinator.
- [Hub-and-Spoke Network](../hub-spoke-network/) — Shared services and egress in a central hub network; workloads live in peered spokes.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [Refactoring.Guru — Mediator](https://refactoring.guru/design-patterns/mediator)
- [Azure Architecture Center — Saga design pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Azure Architecture Center — Hub-spoke network topology in Azure](https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke)
- [MediatR — Simple mediator implementation in .NET (GitHub)](https://github.com/LuckyPennySoftware/MediatR)
- [MediatR — The Simple Yet Powerful Mediator (mediatr.io: editions and licensing)](https://mediatr.io/)
- [React — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
