<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [☁️ Cloud Infrastructure](../../README.md#cloud-infrastructure)

# CDN & Edge Caching

> Serve static content from edge locations close to users; only cache misses reach the origin.

<p align="center"><img src="diagram.svg" alt="Animated diagram: CDN &amp; Edge Caching" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/cdn-edge-caching.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · First request: a miss** | A user in Bangkok asks for `/app.9f3c.js`. The request lands on the nearest **edge location**, which already holds the page but has no copy of this script: a **MISS**. The edge fetches the file from the origin on another continent (the slow leg, about 230 ms here), stores it for as long as the origin's `Cache-Control` header allows, and passes it on. |
| **2 · Hits near the user** | The next Bangkok users get the edge's copy in about 15 ms: a **HIT**, sent with an `Age` header that says how long ago the copy came from the origin. The origin sees none of those requests. Frankfurt and São Paulo each miss on their own first request, because **every edge location fills its cache independently**. |
| **3 · Expiry and revalidation** | `/index.html` was cached with `max-age=600`. Once its age passes that, the copy is **stale**, and the edge has to check it before using it again: it sends a **conditional request** with the copy's `ETag` in `If-None-Match`. The page hasn't changed, so the origin answers **304 Not Modified** with headers and no body, and the same copy is fresh for another 600 s. The user who triggered the check still waited for the origin; with `stale-while-revalidate` the edge answers at once from the stale copy and refreshes it in the background. |
| **4 · Changing content** | A new build ships and the page now loads `/app.a71b.js`. **A new URL is a new cache key**: its first request simply misses and fills, nothing has to be invalidated, and that is why fingerprinted files can be cached for a year and marked `immutable`. `/index.html` keeps its URL, so the deploy **purges** it from every edge, and the next request for it is a miss that brings in the new page. A purge clears the CDN's copies, not the ones already in browsers. |
<!-- END GENERATED: header -->

## The problem

A site served from one region is fast only for the users near that region. Everyone else pays a long round trip for every request, and several of them for a new connection, because the TCP and TLS handshakes have to cross the same distance first. Meanwhile the origin does the same work again and again: most requests are for files that are identical for every user and change only on a deploy, yet each one costs compute and outbound bandwidth, and every traffic spike or attack lands on the origin directly.

## How it works

A content delivery network (CDN) runs a **shared HTTP cache** in many **edge locations** (points of presence, PoPs) around the world. The site's hostname points at the CDN, and DNS or anycast routing sends each user to an edge near them.

- **Miss.** The edge looks the request up under its **cache key**. If it has no stored response, it forwards the request to the **origin**, stores the answer when the origin's headers allow it, and returns it. This first user pays for the trip to the origin.
- **Hit.** Later requests with the same key are answered by the edge, with an `Age` header that says how many seconds ago the response came from the origin. The origin never sees them.
- **Expiry.** A stored response is *fresh* for the lifetime the origin gave it. After that it is *stale*, and the edge **revalidates** it with a conditional request before using it again.
- **Change.** New content reaches users either under a **new URL**, which is a new cache key, or through a **purge** that removes the old copy from every edge.

Edge locations fill their caches independently: a response cached in Bangkok is still a miss in Frankfurt.

The diagram follows two files: the page `/index.html`, which every edge already holds when the loop starts, and the script `/app.9f3c.js` that the page loads, which nobody has asked for yet. Its latencies are illustrative round-trip times, and its clock runs fast: a cached copy ages 20 seconds for every second of animation, so that a 600-second lifetime runs out inside the loop.

This is HTTP caching as infrastructure: it is shared by all users, placed by geography and steered by response headers. An application that keeps its own cache in front of its database is doing [Cache-Aside](../cache-aside/), and the response cache of an [API Gateway](../api-gateway/) is a single cache that sits next to the services instead of next to the users.

### What belongs on a CDN

| Content | Cache it at the edge? |
|---|---|
| Fingerprinted assets: script and style bundles, fonts and images with a content hash in the name | Yes, for as long as you like. The content behind such a URL never changes. |
| Media and downloads: video segments, installers, PDFs | Yes. They are large, so they account for most of the bytes saved. |
| Public pages and public API responses: a `GET` with the same answer for everyone | Yes, with a short lifetime or a purge when they change. Even a few seconds of caching absorbs a spike. |
| Anything personal: account pages, baskets, responses to requests that carry `Authorization` or a session cookie, responses that set a cookie | **No.** Send `Cache-Control: private` (the user's browser may keep it) or `no-store` (nothing may). |

HTTP protects only part of the last row by default. A shared cache may not reuse the response to a request that carried `Authorization` unless that response says `public`, `s-maxage` or `must-revalidate`. Cookies get no such protection: RFC 9111 states that `Set-Cookie` does not inhibit caching. Some products add a guard of their own (depending on its settings, Cloudflare either leaves a response that sets a cookie uncached or strips the cookie before caching it), but labelling private responses is the origin's job. Files that are private but identical for everyone allowed to see them, such as paid downloads, can still be served from the edge if the edge checks a signed URL or signed cookie first, which is the idea behind the Valet Key pattern.

### The cache key

The key decides which requests share a stored response. RFC 9111 builds it from at least the method and the target URI, which in practice means the host, the path and the query string of a `GET`. A response can extend its own key with `Vary`: `Vary: Accept-Encoding` keeps the gzip and Brotli variants apart.

Products start from different defaults, so read yours. CloudFront's default key is only the distribution's domain name and the URL path; query strings, headers and cookies join it when a cache policy adds them. Cloudflare's default key is the full URL (scheme, host, path and query string) plus the `Origin` request header and a few forwarding headers, and by default it acts on `Vary` only for `Accept-Encoding`.

The key can be wrong in two directions:

- **Too wide:** it includes things that don't change the response, such as tracking parameters (`utm_source`), query parameters in random order, or `Vary: User-Agent`. Every variant becomes its own entry, the hit ratio collapses, and anyone can force misses by adding a random parameter.
- **Too narrow:** the response depends on something that is not in the key, such as a header the application copies into the page (`X-Forwarded-Host` is the classic one), a cookie, or the visitor's country. One user's variant is then served to the next. When an attacker supplies that input on purpose it is **web cache poisoning**: one crafted request stores a harmful response, and the edge hands it to everyone who asks for that URL.

**Web cache deception** turns the problem around. The attacker gets a signed-in victim to open a URL that the origin treats as a private page and the CDN treats as a static file, for example `/account/x.css` on an origin that ignores the end of the path. The CDN stores the victim's page, and the attacker fetches it. It works when the cache decides by file extension or path while the origin decides by its own routing. Let the origin's `Cache-Control` decide what is cacheable, send `private` or `no-store` on personal responses, and return 404 for paths that don't exist. Cloudflare's Cache Deception Armor, for example, refuses to cache a response whose `Content-Type` doesn't match the extension in the URL.

### Freshness: `Cache-Control` in a shared cache

| Directive | What it tells the edge |
|---|---|
| `max-age=N` | Fresh for N seconds, in every cache: the edge and the browser. |
| `s-maxage=N` | For shared caches only, replaces `max-age` and `Expires`. It also forbids them to serve the response stale without revalidating it. |
| `public` | May be stored even where it otherwise could not be, for example the response to a request with `Authorization`. An ordinary cacheable response doesn't need it. |
| `private` | Meant for one user: shared caches must not store it, the user's browser may. |
| `no-store` | No cache may store it. |
| `no-cache` | May be stored, but every reuse must be revalidated with the origin first. It does not mean "don't cache". |
| `must-revalidate` | Once stale, never reuse it without a successful revalidation, even if the origin can't be reached. |
| `immutable` (RFC 8246) | The content will not change while it is fresh, so browsers skip the revalidation they would otherwise do on reload. |
| `stale-while-revalidate=N` (RFC 5861) | For N seconds after expiry, answer from the stale copy and refresh it in the background. |
| `stale-if-error=N` (RFC 5861) | For N seconds after expiry, answer from the stale copy if the origin returns 500, 502, 503 or 504. |

The directives are defined in RFC 9111, which replaced RFC 7234 in 2022, unless the table names another RFC.

- **Precedence.** A shared cache takes its lifetime from `s-maxage`, then `max-age`, then `Expires`. With none of them it may guess (*heuristic freshness*, typically a tenth of the time since `Last-Modified`) or fall back to a product default: CloudFront's default TTL is 24 hours unless a cache policy sets another, and Cloudflare keeps a `200` for 120 minutes, but only for the file extensions it caches by default, which exclude HTML and JSON. Send explicit headers on everything.
- **Serving stale.** A cache may serve a stale response only when a directive or its own configuration allows it, or when it cannot reach the origin. `s-maxage`, `must-revalidate` and `no-cache` forbid it, which is why Cloudflare documents that `s-maxage` switches `stale-while-revalidate` off. To split browser and edge lifetimes *and* serve stale while revalidating, use a targeted header.
- **Targeted cache control (RFC 9213).** `CDN-Cache-Control` carries the same directives but is read only by CDN caches, which then ignore `Cache-Control` and `Expires` on that response. `Cache-Control: no-cache` with `CDN-Cache-Control: max-age=600, stale-while-revalidate=60` makes browsers check every time while the edge keeps the page for ten minutes. Support varies: Cloudflare reads `CDN-Cache-Control` and its own `Cloudflare-CDN-Cache-Control`, while Fastly uses the older `Surrogate-Control`, which it removes before the response leaves its network.
- **`Cache-Status` (RFC 9211)** is the standard way for a cache to say what it did. Each cache on the path adds an entry: `ExampleCDN; hit; ttl=412` for a hit with 412 seconds of freshness left, `ExampleCDN; fwd=uri-miss; stored` for a miss that was stored, `ExampleCDN; fwd=stale; fwd-status=304` for a revalidation. Many CDNs still send a header of their own; Cloudflare's `CF-Cache-Status` reports `HIT`, `MISS`, `EXPIRED`, `REVALIDATED` and more.

### Validators and conditional requests

A *validator* (RFC 9110) lets a cache ask "has this changed?" instead of downloading the response again. `ETag` is an opaque version identifier chosen by the origin (strong, or weak when written `W/"…"`), and `Last-Modified` is a timestamp with one-second resolution. The edge sends them back as `If-None-Match` and `If-Modified-Since`; when both are present the origin goes by `If-None-Match`.

If the stored copy is still current, the origin answers **304 Not Modified**: no body, only headers such as `Cache-Control`, `ETag` and `Date`, which the edge merges into its stored response to make it fresh again. Otherwise it answers 200 with the new content, which replaces the old.

Two things follow. A revalidation saves bytes, not the round trip: the user whose request triggers it still waits for the origin, unless `stale-while-revalidate` lets the edge answer first and check afterwards. And without a validator, every expiry costs a full download, so make sure every origin server produces the same `ETag` for the same file.

### New URLs or a purge

**Versioned file names** are the cheap way to change content. Put a hash of the content into the name (`/app.9f3c.js`), and every build that changes the file changes its URL. Nothing is invalidated, old and new files coexist so pages that are already open keep working, a rollback is just the old page again, and the new URL reaches browsers and intermediate proxies that a purge could never touch. CloudFront's documentation recommends versioning over invalidation for much the same reasons. Keep the previous build's files on the origin for a while.

The page that names those files cannot be renamed, so it needs a **purge** (also called invalidation):

- **By URL, prefix or wildcard, by hostname, or everything.** Purge as narrowly as you can. Every purged object is a miss on its next request at every edge, and purging everything sends the whole site's traffic to the origin at once.
- **By tag.** The origin labels each response with the things it depends on (`product-42`, `template-home`), and one call purges everything that carries a label. Fastly reads the labels from a `Surrogate-Key` header, Cloudflare from `Cache-Tag`, and CloudFront from a header you name in the distribution's configuration.
- **How long it takes.** A purge is quick but not atomic across the world. Fastly documents about 150 ms for URL and surrogate-key purges and up to 2 minutes for a purge-all; CloudFront forwards an invalidation to all edge locations within a few seconds; Cloudflare calls its purge instant. Deploy to the origin first and purge second, or an edge can refill with the old version.
- **What it can't reach.** Copies in browsers and in proxies beyond the CDN live out their own `max-age`. That is why the page gets a short browser lifetime, and why assets are versioned instead of purged.
- **Soft purge.** Some CDNs can mark objects stale instead of deleting them (Fastly's soft purge), so `stale-while-revalidate` and `stale-if-error` still have something to serve.

### Fewer and cheaper misses

Because each edge location misses on its own, a file is fetched from the origin once per location, and content that is requested only now and then may never stay cached anywhere: a lifetime is an upper bound, and CloudFront, for one, evicts files that are rarely requested before they expire.

- **Tiered caching, or an origin shield.** Edges ask a parent cache instead of the origin, so one fetch can fill many locations and the origin talks to a few caches instead of hundreds. CloudFront has regional edge caches and, as a paid option, Origin Shield, one more caching layer in front of the origin that the other layers fetch through. Cloudflare's Tiered Cache lets only upper-tier data centres contact the origin, and its Smart Tiered Cache picks the upper tier closest to each origin. Fastly calls it shielding: one PoP that you choose makes the origin requests.
- **Request collapsing.** When many requests miss on the same key at the same moment, the edge forwards one and answers them all from that response, which stops a stampede when a popular object expires. CloudFront and Fastly do this by default. The catch: if the response turns out to be uncacheable, the waiting requests are forwarded one by one, so make sure private responses are recognisable as such.
- **`stale-while-revalidate`** takes the stampede out of an expiry, because nobody waits for the refresh.

## When to use it

- Users are spread across regions or continents, and a large share of what they download is the same for everyone: assets, media, downloads, public pages, public API responses.
- Traffic comes in spikes (a launch, a sale, a news story) and the origin should not have to be sized for the peak.
- The origin should be shielded from the internet. The edge is also where TLS, DDoS absorption, a web application firewall and [Rate Limiting](../rate-limiting/) usually sit, the same idea as Gateway Offloading.

A CDN brings copies of responses close to users. It does not move the origin, so requests that can't be cached still travel the whole way. If those are the slow ones, the answer is more regions ([Multi-Region Active-Active](../multi-region-active-active/)) behind global [Load Balancing](../load-balancing/), usually with a CDN in front as well.

**When not to use one:**

- All the users sit close to the origin (one country, one office network) and traffic is modest. There is little distance to save.
- Nearly every response is personal or changes on every request. Nothing can be shared, so every request is a miss with an extra hop.
- The content is a long tail that is rarely requested twice within its lifetime. The hit ratio stays low and you pay the CDN and the origin for the same bytes.
- Data may not be stored outside a jurisdiction, or by a third party at all.
- Clients sit in locked-down networks that can't reach the CDN's addresses.

## Trade-offs

- **Stale content is the price of speed.** Between a change and the expiry or purge, users see the old version, and different edges and browsers switch at different moments. Pick lifetimes from how stale each kind of content may be.
- **A wrong cache key is a security incident.** A key that is too narrow, or a private response that is cacheable by accident, shows one user's data to another, and cached mistakes outlive the fix until they are purged.
- **One more party in the request path.** The CDN terminates TLS, so it sees your traffic in the clear, and when it fails your site fails with it. Decide in advance how to bypass it or fail over to a second CDN.
- **Harder to debug.** "What did this user get, from which edge, and how old was it?" needs `Cache-Status` or the vendor's equivalent, `Age`, and edge logs.
- **A miss is no faster than before.** It adds a hop, and a purge or a cold start turns everything into misses at once. A site with little traffic per edge location sees mostly misses.
- **Configuration becomes vendor-specific.** Cache rules, edge functions and purge APIs differ between CDNs. Keep as much of the policy as possible in standard response headers.

## Implementation notes

Vendor features and defaults change; the examples here were checked against the vendors' documentation in October 2026.

**Choosing lifetimes**

| Content | Headers | How it is updated |
|---|---|---|
| Fingerprinted assets | `Cache-Control: max-age=31536000, immutable` | A new URL with every build; never purged |
| HTML and other stable URLs that must change promptly | `Cache-Control: max-age=0, s-maxage=600`, or `no-cache` plus `CDN-Cache-Control: max-age=600`; an `ETag` | Purged on deploy; the short browser lifetime covers what a purge can't reach |
| Public API responses | `max-age` of seconds to minutes with `stale-while-revalidate` and `stale-if-error` | Expiry, plus a purge by tag when it matters |
| Images and media at stable URLs | Hours to days; an `ETag` or `Last-Modified` | Purge by URL or tag |
| Personal responses | `Cache-Control: private` or `no-store` | Never cached at the edge |

The diagram gives its page a plain `max-age=600` to keep the picture simple. That also lets browsers keep the page for ten minutes, which the second row avoids.

**Protect the origin**

- Only the CDN should be able to reach it. Otherwise anyone who finds its address bypasses the cache, the firewall rules and the rate limits. The usual options are private connectivity (CloudFront VPC origins), allowing only the CDN's published address ranges (the AWS-managed prefix list for CloudFront), a secret header that the CDN adds and the origin checks, mutual TLS from the CDN (Cloudflare's Authenticated Origin Pulls), and for object storage a bucket policy that admits only the CDN (CloudFront origin access control).
- TLS ends at the edge: the CDN presents your certificate, and the handshake happens near the user. The edge then opens its own connection to the origin. Encrypt that leg too and have the CDN validate the origin's certificate (CloudFront's HTTPS-only origin protocol policy, Cloudflare's *Full (strict)* mode). A mode that speaks plain HTTP to the origin, such as Cloudflare's *Flexible*, leaves that leg readable.

**Measure it**

- The **cache hit ratio** is the share of requests answered from the cache. Track it by bytes as well, since bytes drive the bill.
- Break it down **by region or edge location**, by content type and by path. A healthy global average can hide a region with few users where objects are evicted or expire before the next request arrives.
- Sources: the CDN's analytics (Cloudflare's Cache Analytics, CloudFront's optional *cache hit rate* metric), edge logs (CloudFront's `x-edge-result-type` distinguishes `Hit`, `RefreshHit` and `Miss`, and `x-edge-location` names the edge), and the `Cache-Status` and `Age` headers seen by real users or probes.
- Watch the origin's request rate and latency next to it. A falling hit ratio usually means a fragmented cache key, a lifetime that is too short, or a cookie or `Vary` header that crept into the response.

**Cost**

- CDNs charge for the data they deliver and usually per request, at rates that differ by region; some sell flat monthly plans instead (CloudFront has both, and its *price classes* leave out the most expensive regions). A hit costs only the CDN's delivery charge. A miss also costs an origin response, and origin egress unless the provider waives it between its own services, as AWS does between its origins and CloudFront.
- Extras add up: purges (CloudFront's first 1,000 invalidation paths a month are free, and a wildcard or a tag counts as one path), an origin shield, logs and edge compute.

**Details that bite**

- Never decide cacheability by file extension alone, and don't cache responses that carry `Set-Cookie`.
- Normalise the key: drop tracking parameters, sort or allow-list query parameters, and add a header to the key only when the response really depends on it.
- If responses differ by `Origin` (CORS), the key must include it, or one site's CORS headers are served to another.
- Decide how long errors are cached. A cached 404 or 5xx keeps failing after the origin has recovered, and CDNs have separate settings for it.
- Check with `curl -sI`: `Age`, `Cache-Status` or the vendor's header, and the `Cache-Control` that actually arrives.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Cache-Aside](../cache-aside/) — Read from the cache first; on a miss load from the database and populate the cache.
- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Multi-Region Active-Active](../multi-region-active-active/) — Serve users from several regions at once and shift traffic away from a region that fails.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- Gateway Offloading *(planned)* — Move TLS termination, authentication and compression out of every service into the gateway.
- Valet Key *(planned)* — Give clients a short-lived, narrowly scoped URL to read or write storage directly.

## References

- [RFC 9111 — HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)
- [RFC 9110 — HTTP Semantics (validators, conditional requests, 304 Not Modified)](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 5861 — HTTP Cache-Control Extensions for Stale Content](https://www.rfc-editor.org/rfc/rfc5861.html)
- [RFC 8246 — HTTP Immutable Responses](https://www.rfc-editor.org/rfc/rfc8246.html)
- [RFC 9213 — Targeted HTTP Cache Control](https://www.rfc-editor.org/rfc/rfc9213.html)
- [RFC 9211 — The Cache-Status HTTP Response Header Field](https://www.rfc-editor.org/rfc/rfc9211.html)
- [MDN — HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)
- [Azure Architecture Center — CDN guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/cdn)
- [Amazon CloudFront Developer Guide — Manage how long content stays in the cache (expiration)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html)
- [Amazon CloudFront Developer Guide — Understand the cache key](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-the-cache-key.html)
- [Amazon CloudFront Developer Guide — Invalidate files to remove content](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)
- [Amazon CloudFront Developer Guide — Use Amazon CloudFront Origin Shield](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-shield.html)
- [Amazon CloudFront Developer Guide — Request and response behavior for custom origins (request collapsing)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html)
- [Cloudflare Cache docs — Default Cache Behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Cloudflare Cache docs — CDN-Cache-Control](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/)
- [Cloudflare Cache docs — Revalidation](https://developers.cloudflare.com/cache/concepts/revalidation/)
- [Cloudflare Cache docs — Purge cache](https://developers.cloudflare.com/cache/how-to/purge-cache/)
- [Cloudflare Cache docs — Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)
- [Cloudflare Cache docs — Cache Deception Armor](https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/)
- [Fastly Documentation — Purging](https://www.fastly.com/documentation/guides/concepts/cache/purging/)
- [Fastly Documentation — Shielding](https://www.fastly.com/documentation/guides/getting-started/hosts/shielding/)
- [Fastly Documentation — Request collapsing](https://www.fastly.com/documentation/guides/concepts/cache/request-collapsing/)
- [James Kettle (PortSwigger Research) — Practical Web Cache Poisoning (2018)](https://portswigger.net/research/practical-web-cache-poisoning)
- [Mirheidari et al. — Cached and Confused: Web Cache Deception in the Wild (USENIX Security 2020)](https://www.usenix.org/conference/usenixsecurity20/presentation/mirheidari)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
