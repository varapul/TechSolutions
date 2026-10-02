<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🚪 API & Edge](../../README.md#api--edge)

# Webhooks

> Notify subscribers by calling their HTTP endpoints, with signatures, retries and idempotency.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Webhooks" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/webhooks.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Don't poll, get called** | The subscriber registers an HTTPS endpoint and the event types it wants, once, and gets a **signing secret** back. From then on the provider calls that URL with an HTTP `POST` and a JSON payload whenever such an event happens. The alternative is polling the provider's API every few seconds: most answers are empty, and the news still arrives late. |
| **2 · Verify before trusting** | The endpoint is a public URL, so every request carries an ID, a timestamp and a **signature**: an HMAC over the ID, the timestamp and the raw body, keyed with the shared secret. The receiver recomputes it over the bytes exactly as they arrived, compares the two in constant time and rejects timestamps older than a few minutes, which stops replays. A forged request has no valid signature and is refused before anything is queued. |
| **3 · Ack fast, retry failures** | The receiver stores the verified event on its own queue and answers `2xx` within milliseconds; a worker does the real work afterwards, so slow processing never runs into the provider's timeout. When the endpoint is down the provider gets a `5xx` or no answer at all and tries again after growing delays, minutes at first and then hours, logging every attempt. After the last attempt the delivery is marked **failed** and can be redelivered by hand or through the API. |
| **4 · Duplicates and order** | The `2xx` for `evt_a43` is lost, so the provider sends the event again: its ID is already in the processed-IDs table and the worker skips it. Then `evt_a42` is redelivered and arrives after a newer event about the same payment. The receiver compares the event's own timestamp with the state it holds, or fetches the current state from the API, instead of trusting arrival order. |
<!-- END GENERATED: header -->

## The problem

Something happens in a system that belongs to another organisation, and yours has to react: a payment succeeds at the payment platform, a commit is pushed to a hosted repository, an order is placed in a shop. Their system knows at once. Yours finds out only by asking, unless they tell you.

Asking is **polling**: call the provider's API every few seconds and look for anything new. Most answers are empty, the news arrives up to one interval late, and the provider has to serve all those empty requests. A **long-lived connection** (WebSocket, Server-Sent Events) delivers promptly, but both sides keep a connection open for every subscriber. A shared **message queue** has the delivery semantics you want, but two organisations rarely share a broker, its credentials and its client library.

A **webhook** turns the API around: the subscriber registers a URL, and the provider sends an HTTP `POST` to it when something happens. Every platform can receive an HTTP request, which is why webhooks became the usual way for one company's system to notify another's. The hard part is what that call crosses: the public internet, between two organisations, with no broker in the middle. The receiver has to establish who is calling. The sender has to cope with a receiver that is slow or down. Both have to accept that a notification can arrive twice, late, or after a newer one.

## How it works

1. **Subscribe.** The subscriber registers an HTTPS URL and the event types it wants. From then on the provider and the subscriber share a **signing secret** for that endpoint.
2. **Deliver.** When an event occurs, the provider builds a payload (usually JSON), signs it and sends it as an HTTP `POST` to every endpoint subscribed to that type. Each event has a unique ID.
3. **Verify.** The receiver recomputes the signature over the raw request body and refuses anything that doesn't match or is too old.
4. **Acknowledge.** The receiver stores the event durably, on a queue of its own, and answers `2xx` straight away. To the provider a `2xx` means delivered. Any other status, or no answer within its timeout, means failed.
5. **Retry.** The provider repeats a failed delivery after growing delays and records every attempt in a delivery log. After the last attempt it marks the delivery as failed, and the subscriber can have it sent again by hand or through an API.
6. **Process.** A worker takes the event off the queue, checks whether that ID has been handled before, and does the work.

### Webhooks next to the alternatives

| | Who starts each exchange | Delay | The subscriber needs | The provider needs |
|---|---|---|---|---|
| **Polling** | The subscriber, on a timer | Up to one interval | An API client | Capacity for requests that mostly return nothing |
| **Long-lived connection** (WebSocket, Server-Sent Events) | The subscriber connects, then the provider pushes | Low | A client that reconnects and resumes from a cursor | An open connection for each subscriber |
| **Webhook** | The provider, once for each event | Low | A public HTTPS endpoint that is nearly always up | A delivery system with retries and a log |
| **Shared queue or event bus** | The provider publishes, the subscriber consumes | Low | Access to the same broker | The same |

They combine. A careful integration takes webhooks for speed and still polls now and then to pick up what the webhooks missed. Some providers will also publish into the subscriber's own cloud account instead of calling a URL: Stripe can send events to Amazon EventBridge or Azure Event Grid, and Shopify to Google Cloud Pub/Sub or Amazon EventBridge.

### Establishing who is calling

A webhook endpoint is a public URL that accepts `POST` requests. Without a check, anyone who learns the URL can tell your system that a payment has succeeded.

- **HTTPS only.** TLS keeps the payload private and lets the provider check that it is talking to your server. Short of mutual TLS it tells you nothing about the caller, and a signature does not encrypt anything, so you need both.
- **A signature over the raw body.** The provider computes an HMAC (RFC 2104), in practice HMAC-SHA256, over the request body and usually some metadata, keyed with the endpoint's secret, and sends it in a header. The receiver computes the same value and compares. Use the bytes exactly as they arrived: a framework that parses the JSON and serialises it again changes whitespace or key order, and the signature no longer matches. Compare with a constant-time function (`hmac.compare_digest`, `crypto.timingSafeEqual`): an ordinary string comparison stops at the first differing character, and its timing leaks how much of a guess was right.
- **A timestamp inside the signature.** A captured request stays valid for as long as the secret does. Signing a timestamp with the body lets the receiver refuse anything older than a tolerance, which limits a replay to that window. Five minutes is the default in Stripe's libraries and in the Standard Webhooks reference libraries. A provider that signs a timestamp generates a new one for every attempt, so a retry that arrives hours later still passes. The receiver's clock has to be right.
- **Rotation with an overlap.** To change a secret without dropping deliveries, the provider signs each request with the old and the new secret for a while and sends both signatures, and the receiver accepts a request if any one of them matches. Stripe lets the old secret live for up to 24 hours when you roll it. After a suspected leak, skip the overlap: an overlap keeps the leaked secret valid.
- **An IP allowlist is a second line, not the first.** Providers such as Stripe and GitHub publish the addresses their deliveries come from, and a firewall rule cuts down on noise. But the ranges change (GitHub tells you to refresh the list periodically), the same addresses carry the webhooks of every customer of that provider, including an attacker who registers your URL in an account of their own, and an address says nothing about whether the body was altered.
- **Asymmetric signatures.** With an HMAC, whoever can verify can also forge, and the provider has to store a secret for every endpoint. A provider can sign with a private key instead and publish the public one. Standard Webhooks defines such a variant with Ed25519.

### One convention for the headers

Every provider invented its own header names and signing rules. **Standard Webhooks** is an open specification that settles them. A sender that follows it adds three headers, and they are the ones in the diagram:

| Header | Content |
|---|---|
| `webhook-id` | A unique ID for the event. It is the same on every retry, so it doubles as the idempotency key |
| `webhook-timestamp` | When this attempt was sent, in seconds since the Unix epoch. It changes with every attempt |
| `webhook-signature` | `v1,` followed by the base64 HMAC-SHA256 of `id.timestamp.body`. During a rotation it holds several signatures separated by spaces |

The secret is 24 to 64 random bytes, written in base64 with a `whsec_` prefix. The asymmetric variant uses the prefix `v1a,` in the header. The specification also recommends a payload shape (`type`, `timestamp`, `data`), payloads under 20 KB, a retry schedule with exponential backoff and jitter that runs for several days, and a meaning for some status codes: `410 Gone` tells the sender to disable the endpoint, and `429`, `502` and `504` tell it to slow down.

**CloudEvents**, a graduated CNCF project, standardises the envelope instead: every event has an `id`, a `source`, a `type` and a `specversion`. Its companion specification, *HTTP 1.1 Web Hooks for Event Delivery*, makes HTTPS and `POST` mandatory, has the sender authenticate with a token (in the `Authorization` header or an `access_token` query parameter), and adds a handshake against abuse: the sender first makes an `OPTIONS` request carrying `WebHook-Request-Origin`, and only a target that answers with `WebHook-Allowed-Origin` has agreed to be called. It defines no payload signature, so a provider that wants both can send a CloudEvents envelope and sign it the Standard Webhooks way.

### What the payload carries

- A **fat** payload (also called full, or a snapshot) carries the object as it was when the event occurred. The receiver needs no second call, but the copy may be stale by the time it is processed, it exposes data to anyone who can read the request, and its shape becomes a contract.
- A **thin** payload carries the event type and the IDs involved, and the receiver fetches the object from the API. What it reads is always current and is protected by the API's own access control. The price is one API call for each event, which needs credentials, counts against rate limits and fails when the API is down.

Stripe offers both, as *snapshot events* and *thin events*. Many providers choose a middle way: the ID and type, plus the few fields nearly every receiver wants.

A fat payload is an API response that you push, so it needs **versioning** like any API. Add fields but don't change or remove them within a version, let each endpoint choose its version, and say in the payload which version it is. Stripe's snapshot events are versioned by API version, while its thin events are unversioned, which lets an integration move to a newer API version without reconfiguring its endpoints. On the receiving side, ignore fields you don't know, and answer `2xx` to event types you don't handle so the provider stops retrying them.

### What delivery promises

- **At least once.** The provider cannot tell "not received" from "received, but the `2xx` got lost", so it sends again. The same event ID can therefore arrive more than once, and the receiver has to be an [idempotent consumer](../idempotent-consumer/).
- **No ordering.** Deliveries run in parallel and retries arrive late, so a `payment.refunded` can overtake the `payment.succeeded` it follows. Stripe and Shopify both state that order is not guaranteed.
- **Not for ever.** Retries stop after hours or days. An endpoint that was down for longer has lost events for good unless it fetches them some other way.

### The specification next to three providers

As documented on 2 October 2026. These details change, so check the provider's documentation before relying on them.

| | Standard Webhooks (specification) | Stripe | GitHub | Shopify (HTTPS delivery) |
|---|---|---|---|---|
| **Signature header** | `webhook-signature: v1,<base64>` | `Stripe-Signature: t=<time>,v1=<hex>` | `X-Hub-Signature-256: sha256=<hex>` | `X-Shopify-Hmac-SHA256: <base64>` |
| **HMAC-SHA256 over** | `id.timestamp.body` | `timestamp.body` | The body | The body |
| **Key** | A secret for each endpoint | A secret for each endpoint, `whsec_…` | A secret you choose when you create the webhook | The app's client secret |
| **Replay protection** | The receiver checks `webhook-timestamp` against a tolerance | Signed timestamp; 5 minutes by default in Stripe's libraries | No signed timestamp | No signed timestamp |
| **ID to deduplicate on** | `webhook-id` | The event's `id` | `X-GitHub-Delivery`, unchanged on a redelivery | `X-Shopify-Webhook-Id` |
| **Time to answer** | Recommends that senders wait 15 to 30 s | No figure given: return `2xx` before any complex logic | 10 s | 1 s to connect, 5 s for the whole request |
| **Automatic retries** | Recommends backoff with jitter over several days; its example makes 10 attempts in a little over 3 days | Live mode: for up to 3 days, with exponential backoff. Sandboxes: 3 times over a few hours | None | 8 retries over 4 hours. After 8 consecutive failures a subscription created through the Admin API is deleted |

GitHub leaves recovery to the subscriber: a failed delivery stays failed until someone redelivers it by hand or through the REST API, and GitHub's documentation shows a scheduled script that does so. Stripe lets you resend an event from the Dashboard for 15 days after it was created, and with the Stripe CLI for 30.

## When to use it

- One organisation's system has to notify another's, server to server: payments, source control, commerce, messaging, identity providers.
- A platform wants its customers' systems to react to what happens inside it without giving them access to its internals.
- The events for any one subscriber are occasional to moderately frequent, and a delay of seconds is fine.
- **Not for high-volume streams.** One HTTP request for each event, each with its own signature, retry state and log entry, is an expensive way to move thousands of events a second. Use a log or an event bus with batching and a cursor.
- **Not when the receiver cannot be called.** Browsers, mobile and desktop apps, command-line tools and servers behind a firewall have no public endpoint. They poll, hold a connection open, or use a relay that does. For local development, a tunnel or the provider's tooling fills the gap (the Stripe CLI can forward events to `localhost`).
- **Not when the caller needs the answer.** A webhook response says only "received". If the provider needs a result, that is an ordinary API call.
- **Not inside one system.** Where both ends can share a broker, [publish events to it](../event-driven-architecture/) and get retention and replay from it.

## Trade-offs

- **The receiver has to be public and nearly always up.** It is one more internet-facing endpoint to secure and operate, and its downtime turns into retries and then into lost events.
- **No back-pressure.** The provider sets the pace. A burst (every subscription renewing on the first of the month) arrives as a burst, and the receiver's only brakes are a queue of its own and a `429` or `503` that the provider may or may not honour.
- **Duplicates and disorder are the receiver's problem.** The handler needs a record of processed IDs and a rule for stale events. An ordered log read with a cursor would do most of that work for it.
- **Security work on both sides.** The receiver must verify every request and guard a secret. The provider makes requests to URLs chosen by its users, which is a textbook opening for server-side request forgery.
- **Every provider is different.** Header names, what is signed, timeouts, retry schedules and redelivery all vary, so each integration is written and tested separately. Standard Webhooks exists to shrink that.
- **Hard to see end to end.** A missing webhook could be an event that never fired, a subscription that doesn't cover the type, a delivery that failed, or a handler that threw. Without a delivery log on one side and request logs on the other, nobody can tell which.

## Implementation notes

### Receiving

- **Verify first, on the raw bytes.** Read the body before any JSON middleware touches it. In Express that means `express.raw()` on the webhook route, and other frameworks have an equivalent. Check the timestamp, compute the HMAC, compare in constant time, and use the provider's library when there is one. For a Standard Webhooks sender the check looks like this:

  ```python
  import base64, hashlib, hmac, time

  def verify(secret: str, headers: dict, raw_body: bytes, tolerance: int = 300) -> bool:
      key = base64.b64decode(secret.removeprefix("whsec_"))
      msg_id, sent_at = headers["webhook-id"], headers["webhook-timestamp"]
      if abs(time.time() - int(sent_at)) > tolerance:      # too old or too far ahead: a replay
          return False
      signed = f"{msg_id}.{sent_at}.".encode() + raw_body  # the bytes as received
      expected = hmac.new(key, signed, hashlib.sha256).digest()
      for candidate in headers["webhook-signature"].split(" "):  # several during a rotation
          version, _, signature = candidate.partition(",")
          if version == "v1" and hmac.compare_digest(expected, base64.b64decode(signature)):
              return True
      return False
  ```

- **Refuse without explaining.** Answer a bad signature with a `4xx` such as `401` and an empty body, and accept only the signature scheme you expect. Exempt the route from the CSRF check your framework applies to form posts: the provider has no token to send, and the signature is the control that replaces it.
- **Queue, then answer.** Write the verified event to a durable queue or a table and return `2xx`. Return it only after that write has succeeded, or a crash loses an event the provider believes it delivered. The queue also gives you [load levelling](../queue-based-load-leveling/) when a burst arrives.
- **Deduplicate on the event ID.** Record the ID with a unique key in the same transaction as the work, as the [idempotent consumer](../idempotent-consumer/) pattern describes, and keep IDs for longer than the provider can still send the event: its retry period plus the time in which someone may redeliver by hand. Stripe notes that one change can occasionally produce two events with different IDs. Only a check on the object and the event type catches those.
- **Don't trust arrival order.** The robust rule is to treat the event as a hint and fetch the object's current state from the API. If you apply payloads directly, apply one only when it is newer than what you hold, using a version or sequence number where the provider documents one. Timestamps are weaker: Shopify recommends its `X-Shopify-Triggered-At` header or the payload's `updated_at`, while Stripe warns that its `created` field has one-second resolution and should not be used to order events. In any case compare the time the event *occurred*, never the delivery timestamp, which is new on every attempt.
- **Reconcile, and subscribe narrowly.** Run a periodic job that lists recent objects or events from the API and repairs whatever the webhooks missed. Shopify's documentation says outright that an app should not rely on webhooks alone. Ask only for the event types you handle: the rest is load, and data you have no reason to hold.
- **Park what keeps failing.** An event that the worker cannot process after several tries belongs in a dead-letter queue with an alert, not back at the provider as a `500`: the provider can do nothing about your bug.
- **Watch it.** Alert on signature failures (someone is probing), on the age of the oldest queued event, and on silence: an endpoint that normally hears something every minute and has heard nothing for an hour has probably been disabled.
- **Mind what sits in front.** The endpoint is usually behind an [API gateway](../api-gateway/) or a load balancer. Make sure nothing there rewrites the body, and that its [rate limit](../rate-limiting/) leaves room for a provider's burst.

### Sending

- **Don't lose the event before it leaves.** Write the event in the same transaction as the business change, as a [transactional outbox](../transactional-outbox/) does, and let the delivery system read from there.
- **One queue for each endpoint.** A dead endpoint holds every request until the timeout. If deliveries share a pool of workers, one subscriber's outage delays everyone's events. Queue and limit concurrency for each endpoint so that a slow subscriber delays only itself.
- **Back off, with jitter, for days.** Follow [retry with backoff](../retry-with-backoff/): delays that grow from seconds to hours, randomised so that retries don't arrive in a wave, and a `Retry-After` header respected when the receiver sends one. Sign every attempt again with a new timestamp and keep the event ID unchanged.
- **Stop calling endpoints that keep failing.** After days of failures, disable the endpoint and tell its owner through another channel such as email. Treat `410 Gone` as an unsubscribe. This is a [circuit breaker](../circuit-breaker/) with a human in the loop.
- **Show the log.** Give subscribers every attempt with its time, status code and duration, and a way to replay one delivery or everything in a time range, in the UI and through the API.
- **Defend against server-side request forgery.** A subscriber-supplied URL can point at your own network or at the cloud metadata service. Accept only `https` URLs. Resolve the hostname and refuse loopback, private, link-local and other non-public addresses, in IPv4 and IPv6, then connect to the address you checked, so that a second DNS lookup cannot swap it. Don't follow redirects. Send from an isolated network segment or through an egress proxy that enforces the same rules (Stripe's open-source Smokescreen is one), and truncate response bodies in the delivery log, so that a gap in these checks doesn't become a way to read internal responses.
- **Prove the subscriber owns the URL** before sending real data, with a challenge it has to echo or the CloudEvents `OPTIONS` handshake. Otherwise your delivery system can be pointed at someone else's site.
- **A secret for each endpoint**, random and long (Standard Webhooks asks for 24 to 64 bytes), and rotatable with an overlap. Sign with every active secret during the overlap.
- **Keep payloads small** and say what they are: an event type, an ID, the time the event occurred, and a version.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Idempotent Consumer](../idempotent-consumer/) — Remember processed message IDs so a redelivered message has no extra effect.
- [Retry with Backoff & Jitter](../retry-with-backoff/) — Retry transient failures with growing, randomised delays so clients don't stampede.
- [Dead-Letter Queue](../dead-letter-queue/) — Park messages that keep failing so they stop blocking the queue and can be inspected.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Publish-Subscribe](../publish-subscribe/) — Broadcast each message to every interested subscriber through a topic.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- Asynchronous Request-Reply *(planned)* — Accept now with 202, process in the background, and let the client poll a status URL.

## References

- [Standard Webhooks — Specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
- [Stripe Docs — Receive Stripe events in your webhook endpoint](https://docs.stripe.com/webhooks)
- [Stripe Docs — Integrate with events (snapshot and thin events)](https://docs.stripe.com/event-destinations)
- [GitHub Docs — Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub Docs — Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub Docs — Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)
- [Shopify — About webhooks](https://shopify.dev/docs/apps/build/webhooks)
- [Shopify — Verify webhook deliveries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [CloudEvents — Specification, version 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
- [CloudEvents — HTTP 1.1 Web Hooks for Event Delivery, version 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/http-webhook.md)
- [OWASP Cheat Sheet Series — Webhook Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html)
- [OWASP Cheat Sheet Series — Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [RFC 2104 — HMAC: Keyed-Hashing for Message Authentication](https://www.rfc-editor.org/rfc/rfc2104)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
