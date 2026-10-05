<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧩 Design Patterns (GoF)](../../README.md#design-patterns-gof)

# Adapter

> Wrap an incompatible interface so existing code can use it unchanged: the classic fix for a third-party or legacy API.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Adapter" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/adapter.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Interfaces that don't fit** | Checkout charges cards through its own `PaymentGateway` interface: `charge(1250, 'EUR')` takes the amount as an integer in minor units (cents here) and returns a `Receipt`. The newly contracted provider's SDK, `LegacyPay`, wants `makePayment({amount: '12.50', curr: 'EUR'})`, a decimal string in major units under other field names, and answers `{status: 'OK', ref: 'PX-77'}` instead of a `Receipt`. `LegacyPay` is not a `PaymentGateway`, so Checkout can't use it as it is. |
| **2 · Wrap it in an adapter** | `LegacyPayAdapter` implements `PaymentGateway` and holds a `LegacyPay`. Its `charge(1250, 'EUR')` calls `makePayment({amount: '12.50', curr: 'EUR'})` and turns `{status: 'OK', ref: 'PX-77'}` into `Receipt {id: 'PX-77', amountMinor: 1250, currency: 'EUR'}`. Neither Checkout nor the SDK changes: the adapter is the only new code. |
| **3 · Translate units and errors** | Currencies differ in how many decimal places they have (their ISO 4217 *minor units*): 1250 is `'1250'` in yen, `'12.50'` in euros and `'1.250'` in Bahraini dinars, so the adapter keeps a table of exponents. Failures are translated too: here `charge(1250, 'BHD')` is declined, and `{status: 'DECLINED', code: '51'}` reaches Checkout as the domain's own `PaymentDeclined` error, so provider codes never leak into checkout code. |
| **4 · Swap providers freely** | A new provider means one more adapter, here `AcmePayAdapter`, and the wiring at start-up decides which one Checkout gets; Checkout's code never changes. This adapter *holds* its SDK (an object adapter); a class adapter would *inherit* from it instead. Facade, Decorator and Proxy also wrap objects, but a Facade puts a simpler interface on a subsystem, and a Decorator or Proxy keeps the same interface to add behaviour or control access; at the scale of whole systems the same idea is an anti-corruption layer. |
<!-- END GENERATED: header -->

## The problem

Checkout code charges cards through an interface the team designed for itself: `PaymentGateway.charge(amountMinor, currency)` returns a `Receipt`, and every amount is an integer in the currency's minor unit, so 1250 means €12.50. The newly contracted provider ships an SDK that does the same job through a different interface: a `makePayment` call that wants the amount as a decimal string in major units (`'12.50'`) under other field names, and that answers with a status object. The SDK can't be edited. Rewriting Checkout in the provider's terms would spread that provider's names, units and error codes through code that shouldn't care who moves the money, and the next provider would mean doing it all again.

## How it works

Gamma, Helm, Johnson and Vlissides list Adapter, also known as Wrapper, among the structural patterns in *Design Patterns* (1994). The idea: when an existing class does what you need but not through the interface your code expects, put a small class in between that offers the expected interface, turns every call into one the existing class understands, and turns every answer back.

- **Target** (`PaymentGateway`): the interface the client is written against. It is yours, and it is shaped by what Checkout needs.
- **Client** (`Checkout`): uses the target and nothing else.
- **Adaptee** (`LegacyPay`): the existing class with the useful behaviour and the wrong interface, typically a vendor SDK, a generated API client or a legacy module.
- **Adapter** (`LegacyPayAdapter`): implements the target and forwards to the adaptee, converting arguments on the way in and results and errors on the way out.

Neither the client nor the adaptee changes. The adapter is the only class that knows both interfaces, and the code that wires the application together hands Checkout a `new LegacyPayAdapter(sdk)` wherever it expects a `PaymentGateway`. Switching providers, as in step 4, changes that one line.

**Object adapter or class adapter.** The book describes two ways to build one:

- An **object adapter** holds the adaptee (composition), as in the diagram. One adapter class works with the adaptee and with any subclass of it, a test fake included, and the adaptee's own methods stay hidden behind the target. This is the usual choice.
- A **class adapter** inherits from the adaptee and implements the target: `class LegacyPayAdapter extends LegacyPay implements PaymentGateway`. It is one object instead of two and can override the adaptee's methods, but it is bound to that one concrete class, and in Java or TypeScript the inherited `makePayment` stays public on the adapter. The book's C++ version inherits from the adaptee privately to avoid that. Languages with single inheritance of classes can build a class adapter only when the target is an interface.

**Two-way adapters.** An adapter no longer looks like its adaptee, so code written against the adaptee can't use it. When two parts of a system need the same object through different interfaces (during a migration, say, old code still calls the legacy interface while new code calls the new one), a two-way adapter implements both. The book builds one with multiple inheritance; with interfaces, one class simply implements the two.

## Code

TypeScript that Node.js 22.18 or later runs as is (`node adapter.ts`: type stripping is on by default from that release). The fake `LegacyPay` has the SDK's call and reply shapes and records every request, so the asserts can check exactly what the provider would have received.

```ts
import assert from 'node:assert/strict';

// Target: the interface checkout code is written against.
interface Receipt { id: string; amountMinor: number; currency: string }
interface PaymentGateway { charge(amountMinor: number, currency: string): Receipt }
class PaymentDeclined extends Error {}

// Adaptee: the provider's SDK, faked here with its real call and reply shapes.
type LegacyRequest = { amount: string; curr: string };
type LegacyReply = { status: 'OK'; ref: string } | { status: 'DECLINED'; code: string };
class LegacyPay {
  sent: LegacyRequest[] = [];
  declineNext = false;
  makePayment(req: LegacyRequest): LegacyReply {
    this.sent.push(req);
    return this.declineNext ? { status: 'DECLINED', code: '51' } : { status: 'OK', ref: 'PX-77' };
  }
}

// ISO 4217 minor units: how many digits follow the decimal point.
const MINOR_UNITS: Record<string, number> = { JPY: 0, EUR: 2, BHD: 3 };

// 1250 -> '12.50' with string arithmetic only: no binary floating point.
function toDecimal(amountMinor: number, currency: string): string {
  const exp = MINOR_UNITS[currency];
  if (exp === undefined) throw new Error(`unsupported currency ${currency}`);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError(`bad amount ${amountMinor}`);
  if (exp === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exp + 1, '0');
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

// Adapter: implements PaymentGateway, holds a LegacyPay, translates both ways.
class LegacyPayAdapter implements PaymentGateway {
  private readonly sdk: LegacyPay;
  constructor(sdk: LegacyPay) { this.sdk = sdk; }

  charge(amountMinor: number, currency: string): Receipt {
    const reply = this.sdk.makePayment({ amount: toDecimal(amountMinor, currency), curr: currency });
    if (reply.status === 'DECLINED') throw new PaymentDeclined('card declined'); // the code stays here
    return { id: reply.ref, amountMinor, currency };
  }
}

// Client: checkout code knows only PaymentGateway, Receipt and PaymentDeclined.
function checkout(gateway: PaymentGateway, totalMinor: number, currency: string): string {
  try { return `paid, receipt ${gateway.charge(totalMinor, currency).id}`; }
  catch (e) { if (e instanceof PaymentDeclined) return 'declined: ask for another card'; throw e; }
}

const sdk = new LegacyPay();
const gateway: PaymentGateway = new LegacyPayAdapter(sdk);
console.log(gateway.charge(1250, 'EUR')); // { id: 'PX-77', amountMinor: 1250, currency: 'EUR' }
gateway.charge(1250, 'JPY');
sdk.declineNext = true;                   // as in step 3, the BHD charge is declined
assert.throws(() => gateway.charge(1250, 'BHD'), PaymentDeclined);
assert.deepEqual(sdk.sent.map((r) => r.amount), ['12.50', '1250', '1.250']);
console.log(checkout(gateway, 1250, 'BHD')); // declined: ask for another card
```

The conversion was also checked on its own for zero (`'0.00'`), the smallest unit (`1` in BHD is `'0.001'`), the largest safe integer, and for a negative amount, a fraction and an unknown currency, which all throw. The exponent table is deliberately tiny: a real one lists every currency you accept, takes its values from ISO 4217 (the maintenance agency, SIX, publishes the list as XML and XLS), and refuses a currency it doesn't know instead of guessing two decimals.

## When to use it

- A class does the job but not through the interface your code expects, and you can't or shouldn't change either side: a vendor SDK, a generated API client, a legacy module, a platform API.
- You want a vendor's names, units and status codes kept out of your domain, so that a provider can be replaced, or several used side by side, by writing one adapter each.
- Not when you own both sides and can simply change one of them, and not to rescue a badly designed target: fix the target.
- Not when the difference is in behaviour rather than shape. If a provider confirms payments later, through a webhook, a synchronous `charge()` that returns a `Receipt` is the wrong target, and an adapter that hides the difference will report payments that haven't happened. Change the target instead, for example to return a pending payment.

## Trade-offs

- **One more class per adaptee**, and every call goes through one more object. The runtime cost is negligible; the real cost is code to own, review and test.
- **The target decides how well it ages.** Shape it from the client's needs, not from the first provider's API, or every later adapter will have to fight it. [Hexagonal Architecture](../hexagonal-architecture/) makes the same point about ports.
- **Lowest common denominator.** A target that every provider can serve may hide a feature only one of them offers, and extending the target for one provider makes every other adapter implement or reject the new method.
- **Semantics leak through.** Timeouts, partial captures, 3-D Secure challenges and idempotency are behaviour, not format, and no adapter can make them disappear. If the client has to react to them, the target has to model them.
- **Class adapters couple harder.** They are bound to one concrete class and expose its methods, which is why object adapters are the default.

## Implementation notes

**What belongs in an adapter.** Translation, and nothing else:

- *Shape:* method and field names, nesting, optional fields, enumerations and status values.
- *Units and formats:* minor or major units, decimal strings, the case of currency codes, date and time formats.
- *Errors:* every documented provider failure mapped to one of your own error types (here `PaymentDeclined`), and anything unknown treated as an error too. Log the provider's raw code with a correlation ID, since support will need it, but don't pass it up. Telling a decline (don't retry) from a timeout (outcome unknown) is part of the translation.
- *Not policy:* retries, timeouts, circuit breaking, caching and metrics go in a decorator around `PaymentGateway`, which keeps the interface and adds behaviour, or in the infrastructure, for example an [Ambassador](../ambassador/); see [Retry with Backoff](../retry-with-backoff/) and [Circuit Breaker](../circuit-breaker/). A payment retry also needs an idempotency key, or it may charge the card twice. An adapter that only translates stays small and is easy to test against recorded responses.
- *Not business rules:* whether to charge, how much, fraud checks.

**Money: integers in minor units, never binary floating point.** In JavaScript `0.1 + 0.2` is `0.30000000000000004`, because a `number` is a binary double. Keep amounts as integers in minor units, or in a decimal type such as Java's `BigDecimal`, and convert to the provider's format with integer and string operations, as `toDecimal` does. A JavaScript `number` holds integers exactly only up to 2⁵³ − 1 (9,007,199,254,740,991); use `BigInt` beyond that. The number of decimals belongs to the currency: ISO 4217 lists it as the *minor unit*, 0 for JPY, 2 for EUR, 3 for BHD and KWD, and even 4 for units of account such as CLF and UYW. Two traps:

- Don't derive exponents from display formatting. `Intl.NumberFormat` follows CLDR's display conventions, which differ from ISO 4217 for some currencies: with Node.js 22, thirteen of them, the Iraqi dinar among them (3 minor units in ISO 4217, 0 fraction digits in `Intl`).
- Providers add rules of their own. [Stripe](https://docs.stripe.com/currencies), for example, expects every amount in the currency's minor unit, yet asks for Icelandic króna with two decimals that are always zero, for backward compatibility, although ISO 4217 gives ISK no minor unit. A quirk like that belongs in that provider's adapter and nowhere else.

Converting between representations should be exact: if an amount can't be expressed the way the provider wants it, fail loudly instead of rounding quietly. Rounding is a business decision (tax, currency conversion, splitting a bill), made once, on your side of the boundary.

**Testing.** Test the adapter on its own, at three levels:

- unit tests against a fake adaptee, as in the code above: each currency's exponent, zero, the smallest unit, the largest safe amount, unknown currencies and every documented status;
- replay tests against recorded responses: capture real request and response pairs from the provider's sandbox once and replay them, so the tests stay fast and still see the provider's real formats. [WireMock](https://wiremock.org/docs/record-playback/), for example, can act as a proxy in front of an API and record the traffic as stubs;
- a few contract tests against the sandbox itself, run on a schedule, to catch the day the provider changes something.

Checkout's own tests then need no provider at all: they get a fake `PaymentGateway`.

**Adapters in migrations and between bounded contexts.**

- In a [Strangler Fig](../strangler-fig/) migration, new code is written against its own interfaces while some calls still have to reach the old system. Adapters bridge the gap, and they are deleted together with the legacy code. [Branch by Abstraction](../branch-by-abstraction/) is the same move inside one codebase: put an interface in front of the old implementation, build the new one behind it, switch, then delete the old one.
- An [Anti-Corruption Layer](../anti-corruption-layer/) is the architecture-scale cousin. Between two bounded contexts the layer translates a whole model (names, codes, entities and what they mean), not one method signature, so it combines adapters, facades and translators. It may also run as a service of its own, which adds a network hop and one more thing to deploy, scale and monitor. The rule is unchanged: the other side's terms stop at the layer.
- In [Hexagonal Architecture](../hexagonal-architecture/), `PaymentGateway` would be a driven port and `LegacyPayAdapter` a driven adapter. The GoF pattern is the mechanism at class level; ports and adapters make it the rule for every external dependency.

**Relatives.** Several patterns put one object in front of others; what each does to the interface tells them apart.

- [Facade](../facade/) defines a *new*, simpler interface over a whole subsystem, where an adapter makes *one* class fit an interface that already exists.
- [Decorator](../decorator/) keeps the wrapped object's interface and adds behaviour, so decorators can stack. An adapter's outside differs from its inside.
- Proxy keeps its subject's interface too, and controls access to it: creating it lazily, calling it remotely, checking permissions.
- Bridge can look like an object adapter on a class diagram, but it is designed up front, so that an abstraction and its implementations can vary independently. An adapter is added after the fact, to make classes that already exist work together.

**Where the language helps.** With structural typing (TypeScript, Go), an object that already has the right shape satisfies the interface with no `implements` clause and no wrapper, so you write an adapter only when the shapes really differ. When the target is a single function, a closure is enough: `util.promisify` is an adapter written as a higher-order function. Some languages can even make an existing type conform to a new interface without wrapping it: [Swift extensions](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/#Adding-Protocol-Conformance-with-an-Extension) can add a protocol conformance to a type whose source you don't have, and [Rust](https://doc.rust-lang.org/book/ch10-02-traits.html) lets you implement your own trait for a type from another crate (the orphan rule forbids it only when both the trait and the type are foreign).

**Adapters in standard libraries and frameworks:**

- Java's `InputStreamReader` wraps a byte `InputStream` and offers a character `Reader`, decoding the bytes with a charset. `Arrays.asList` returns a fixed-size `List` backed by an array: writes go through to the array, and the methods that would change the size throw `UnsupportedOperationException`. `Enumeration.asIterator()` (Java 9) adapts the older `Enumeration` to `Iterator`.
- Python's `io.TextIOWrapper` puts a text interface on a buffered binary stream.
- Node.js's `util.promisify` (since Node.js 8) turns a function that takes an error-first callback into one that returns a promise. Calling it on a function that already returns a promise has been deprecated since Node.js 20.8.
- In Spring MVC, the `DispatcherServlet` invokes every handler through a [`HandlerAdapter`](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/special-bean-types.html), so it never needs to know how a particular kind of handler is called.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Facade](../facade/) — Give a complex subsystem one simple entry point, so callers make one call instead of orchestrating many classes.
- [Decorator](../decorator/) — Wrap an object to add behaviour at runtime, stacking wrappers instead of multiplying subclasses for every combination.
- [Proxy](../proxy/) — Stand in for another object with the same interface to control access to it: lazy loading, caching, access checks, remoting.
- [Bridge](../bridge/) — Split an abstraction from its implementation so both vary independently: m shapes and n renderers need m + n classes, not m × n.
- [Strangler Fig](../strangler-fig/) — Put a facade in front of the legacy system and move routes to new services one at a time.
- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.

## References

- [Gamma, Helm, Johnson and Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software (Addison-Wesley, 1994)](https://www.informit.com/store/design-patterns-elements-of-reusable-object-oriented-9780201633610)
- [SIX (ISO 4217 Maintenance Agency) — currency codes and their minor units](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)
- [Java SE 27 API — java.io.InputStreamReader](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/io/InputStreamReader.html)
- [Java SE 27 API — java.util.Arrays.asList](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/Arrays.html#asList(T...))
- [Node.js — util.promisify](https://nodejs.org/api/util.html#utilpromisifyoriginal)
- [Azure Architecture Center — Anti-Corruption Layer pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
- [Refactoring.Guru — Adapter](https://refactoring.guru/design-patterns/adapter)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
