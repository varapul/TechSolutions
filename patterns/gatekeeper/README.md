<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Gatekeeper

> A hardened broker validates and sanitises requests before they reach trusted hosts.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Gatekeeper" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/gatekeeper.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One exposed host** | Without a gatekeeper, the internet-facing claims service both parses untrusted uploads and holds the credentials for the claims database and the document store. One parsing bug is enough: here a crafted upload named `../../config` lands outside the upload folder, the attacker gets code running on the host, and the keys to every policy, claim and document are right there. |
| **2 · Split the roles** | A **gatekeeper** in its own perimeter zone now receives every request. It authenticates the caller, checks the size before reading the body, decodes the request once and validates that form against the contract (known fields only, an allowed content type that matches the actual bytes, safe file-name characters), then forwards a rebuilt, clean request over the one internal endpoint (port 8443, mutual TLS). It holds no data-store credentials: the **trusted host** behind it holds them, and network rules let nothing but the gatekeeper reach that host. |
| **3 · Stopped at the gate** | An upload named `../../config` fails the file-name rule and gets `400 Bad Request`; a 48 MB body fails the size check and gets `413 Content Too Large` before the body is read. Both are logged, and the trusted host never sees either. When the gatekeeper itself is breached, the attacker finds no keys or connection strings there, the network rules allow only the internal endpoint, and the trusted host validates the crafted request it receives and refuses it: defence in depth. |
| **4 · The costs** | The protection has a price: an extra hop and more processing on every request, another tier to scale and keep available (a single instance is a single point of failure), validation rules that must change whenever the service's contract does, and the temptation to put business logic in the gatekeeper. A [valet key](../valet-key/) makes the opposite trade and takes the application out of the data path; a gatekeeper stays in it on purpose, so that every request is inspected. |
<!-- END GENERATED: header -->

## The problem

A service that accepts requests from the internet usually does two very different jobs in the same process:

- **It parses untrusted input.** Headers, query strings, JSON bodies, multipart uploads, file names, and often whole file formats such as PDF or images, through large frameworks and libraries. This is where most exploitable bugs live: path traversal, injection, unsafe deserialisation, parsers that run out of memory.
- **It holds the keys.** Connection strings, storage account keys, or an identity that is allowed to read and write the data behind it.

Put together, one bug in the first job hands over the second. The Azure Architecture Center frames the Gatekeeper pattern around exactly this risk: whoever compromises the application's hosting environment gets the credentials, storage keys and services that the application uses. Keeping the data stores off the internet doesn't help at that point, because the attacker is now running code on a host that is allowed to reach them.

In the diagram, an insurance portal's claims service faces the internet on port 443, parses every document upload itself, and holds the credentials for the claims database and the document store. A crafted upload whose file name is `../../config` lands outside the upload folder, the attacker gets code running on the host, and the keys to every policy, claim and document come with it.

## How it works

Split the two jobs between two hosts that are trusted to different degrees, with one narrow channel between them:

- **The gatekeeper** is the only part that the internet can reach. It receives every request, authenticates the caller, validates and sanitises the request, rejects what doesn't conform, and forwards the rest. It runs with **limited privileges** and holds **no credentials or keys for the data stores** or other services, so a compromised gatekeeper has nothing worth stealing. Azure also says it shouldn't do any application processing or touch data: its only job is to validate and sanitise.
- **The trusted host** (Azure's diagram also calls it the *key master*) does the business work and holds the credentials. It exposes **only internal endpoints**, which only the gatekeeper calls, and nothing external.
- **One channel** connects them: an internal endpoint over TLS, or a queue or broker. Network rules allow nothing else.

Azure compares the gatekeeper to a firewall that understands the application: instead of filtering on addresses and ports, it looks inside each request and makes an application-level decision about whether to pass it on.

1. **One exposed host (before).** The claims service faces the internet and holds the keys. One parsing bug, here the file name `../../config`, gives the attacker the host and the keys with it.
2. **Split the roles.** A gatekeeper in a perimeter zone receives every request. It authenticates the caller, checks the size before reading the body, decodes the request once, validates that form against the contract (known fields only, an allowed content type that matches the actual bytes, safe file-name characters) and forwards a rebuilt request over one internal endpoint: port 8443 with [mutual TLS](../mutual-tls/). The trusted host revalidates it, checks that claim 4471 belongs to this caller, and stores the record and the file.
3. **Stopped at the gate.** `../../config` fails the file-name rule and gets `400 Bad Request`; a 48 MB body fails the 10 MB limit and gets `413 Content Too Large` before the body is read. Both are logged; the trusted host sees neither. Then the gatekeeper itself is breached: the attacker finds no keys or connection strings there, the network rules don't let it reach the stores, and the crafted request it sends over the one endpoint fails the trusted host's own validation.
4. **The costs.** An extra hop on every request, another tier to scale and keep available, rules that must follow the service's contract, and the pull to put business logic in the gatekeeper. A [valet key](../valet-key/) makes the opposite trade.

### What to validate and sanitise

The OWASP Input Validation and File Upload cheat sheets give the checklist. Roughly in the order the gatekeeper runs it:

- **Authenticate the caller first,** so anonymous traffic never reaches the expensive checks. Verifying a signed token needs only the identity provider's public keys (see [JWT validation](../jwt-validation/)), which are not data-store credentials. Fine-grained authorisation ("may user 1182 add documents to claim 4471?") needs the data, so it stays with the trusted host; OWASP also treats authorisation as a separate check from validation.
- **Limit sizes before parsing.** Cap the body, headers and URL before buffering or parsing anything, and set parser limits such as nesting depth: a schema check that runs after parsing can't protect a parser that has already exhausted memory. Answer an oversized body with `413 Content Too Large` (RFC 9110). NGINX's `client_max_body_size`, for example, defaults to 1 MB and returns 413 above it. If uploads are decompressed or extracted later, the limit must apply to the expanded size too.
- **Canonicalise, then validate.** Decode once, as the protocol defines (percent-encoding, character encoding, Unicode normalisation where the field needs it), validate that decoded form, and forward it so that nothing downstream decodes it again. Checking one representation and using another is how `..%2F..%2Fconfig` slips past a check for `../`.
- **Validate against the contract with an allowlist.** Use a schema: required fields, types, lengths, ranges, allowed values, and item counts for arrays, applied to nested objects too. In JSON Schema, decide explicitly about unknown fields (`additionalProperties`); listing properties neither requires them nor rejects the others. Define what is accepted and reject everything else rather than trying to recognise attacks.
- **Reject, don't repair.** OWASP lists "cleaning" input (stripping characters that look dangerous) as a pitfall: it can change a value's meaning and still doesn't make it safe. Return a clear error instead of carrying on with partly validated data.
- **Sanitise by rebuilding.** Forward a request built from the validated fields of the contract, not the client's raw bytes. Unexpected fields and headers are dropped, only intended fields reach the business objects (OWASP's defence against mass assignment), and the gatekeeper and the trusted host can no longer read the same bytes differently, which is what HTTP request smuggling exploits (RFC 9112, section 11.2).
- **File uploads.** Treat the file name and the declared `Content-Type` as untrusted metadata. Accept only an allowlist of types (PDF and JPEG here) and check the file's actual signature against the declared type; neither check is enough on its own. Validate the extension after decoding the name, and watch for double extensions, null bytes, case tricks and NTFS alternate data streams. Reject names with path separators, `..` sequences or a leading dot; better, store the file under a name the server generates and keep the client's name only for display. Scan the content for malware, and for document formats consider **content disarm and reconstruction** (CDR), which rebuilds a file without its active content such as macros and scripts.
- **Injection needs more than validation.** Validation shrinks the attack surface, but it doesn't prevent SQL injection or cross-site scripting by itself: the trusted host still uses parameterised queries and context-aware output encoding. A WAF's injection rules are an extra layer, not the fix.

### Deploying the split

The boundary is only as real as the separation behind it:

- **Separate compute.** Azure's guidance is to run the gatekeeper and the trusted back end on separate compute boundaries. Two processes on one machine share too much: one local privilege escalation and the attacker has both.
- **A separate identity without data-plane rights.** Give the gatekeeper its own workload identity (a managed identity, an IAM role, a Kubernetes service account) whose only permission is calling the trusted host, and give the roles that read and write the database and the blob container only to the trusted host's identity. With managed identities there may be no secret on the trusted host at all, but the principle doesn't change: whoever runs code there can act as it, so it must not face the internet.
- **A separate network zone.** Put the gatekeeper in a perimeter subnet and the trusted host in an internal one, with no public IP address and no route from the internet. On the trusted host, allow inbound traffic only from the gatekeeper, and only on the one port: network security group rules (Azure application security groups let a rule name the gatekeeper's machines as its source), an AWS security group rule that references the gatekeeper's security group, or a Kubernetes `NetworkPolicy`, which needs a network plugin that enforces it (without one, the object has no effect). In a hub-and-spoke network, the perimeter zone and the workload can live in different spokes or in the hub and a spoke, with the same rules between them.
- **Private connectivity to the data.** Make the stores reachable only privately, for example through [private endpoints](../private-endpoints/), and allow only the trusted host's network and identity.
- **Authenticate the hop.** Use TLS between the gatekeeper and the trusted host, preferably [mutual TLS](../mutual-tls/), so that the trusted host can tell the gatekeeper apart from anything else that reaches the port. Azure notes that some hosting environments don't support HTTPS on internal endpoints. Besides an internal endpoint, it also allows a queue or a broker as the channel between the tiers.

### Defence in depth: the trusted host still validates

The gatekeeper must not become the only line. The trusted host should:

- accept calls only from the gatekeeper, authenticated by mutual TLS or a token;
- validate every request again against the same contract. Azure expects the gatekeeper to do the core validation and allows that the trusted host may need more, and OWASP lists trusting data because it arrived over an internal transport as a common mistake;
- authorise against its own data: does claim 4471 belong to user 1182?
- use parameterised queries and output encoding, and store files under server-generated names outside any web root (OWASP even suggests a separate host for stored files).

Then a breached gatekeeper can send only what a well-behaved client could have sent. And because the gatekeeper should already have rejected anything invalid, a validation failure at the trusted host is a strong signal: the gatekeeper was bypassed, misconfigured or compromised.

### What can play the gatekeeper

Examples, checked in October 2026, not requirements:

- **A web application firewall in front of the application.** Azure Application Gateway v2 (v1 was retired on 28 April 2026) with Azure Web Application Firewall applies managed rules based on the OWASP Core Rule Set, custom rules, bot protection and geo-filtering, inspects JSON and XML bodies, and enforces request body and file upload size limits. In prevention mode it blocks the requests its rules flag, with a 403, and logs them; Microsoft suggests running a new WAF in detection mode for a while first, to tune exclusions. AWS WAF can protect an Application Load Balancer, an Amazon CloudFront distribution, an Amazon API Gateway REST API and several other resource types, and answers blocked requests with a 403 or a custom response.
- **Mind the inspection limits.** AWS WAF inspects only the first 8 KB of a body behind an Application Load Balancer (16 KB by default, up to 64 KB, on CloudFront and API Gateway), and each rule that inspects the body decides what happens to an oversize one: inspect what fits, treat it as a match, or treat it as no match. Azure WAF lets you set how deep into a body it inspects, and a low setting can let uninspected content through. A WAF alone therefore can't vouch for a 2 MB PDF: files need checks of their own.
- **An API management tier.** Azure's example of this pattern layers two gatekeepers: Application Gateway with WAF as the outer one, and Azure API Management as the inner one, in front of a back end that is reachable only through a private endpoint. API Management policies validate JWTs, apply rate limits and validate request bodies against the API's schema (`validate-content`, which can also cap the body size, up to 4 MB, and refuse additional properties).
- **A reverse proxy** such as NGINX or Envoy, with size limits, header normalisation and a single upstream, plus your own validation service or plugin for the contract.
- **A scanning or CDR service for files,** inline in the gatekeeper tier or as the first stop for uploads before the trusted host stores them.
- **A small service of your own** that only validates the contract and forwards: often the simplest way to enforce rules such as "PDF or JPEG only, at most 10 MB, for this document category".

### Availability, scaling and throttling

Every request now depends on the gatekeeper, so a single instance is a single point of failure; Azure recommends redundant instances and autoscaling. Run several replicas behind a [load balancer](../load-balancing/) that probes their health ([health endpoint monitoring](../health-endpoint-monitoring/)), spread them across zones, and scale on request rate and CPU: parsing and checking large bodies is real work. The gatekeeper is also the natural place to [rate-limit](../rate-limiting/) abusive clients; Azure points out that throttling there avoids coordinating rate counters across every back-end node. Limit concurrent uploads per client too, since slow, large uploads hold connections open.

### Logging and alerting

Rejections are security signals, so keep them:

- Log each rejection with the rule that fired, the status code, the caller, the client address, the size and a correlation ID. Following OWASP, leave out full bodies and secrets, and escape any untrusted value you do keep so that it can't forge log lines.
- Send the WAF's, the gatekeeper's and the trusted host's logs to one place ([centralized logging](../centralized-logging/)), and generate or forward a correlation ID at the edge so a request can be followed across every layer ([distributed tracing](../distributed-tracing/)), as Azure's example recommends.
- Alert on spikes in rejections, on many rejections from one client (then throttle or block it), and on any validation failure at the trusted host.

### Where it sits among other patterns

- **[Valet key](../valet-key/)** makes the opposite trade. It takes the application out of the data path: the client gets a short-lived, narrowly scoped key and talks to storage directly. A gatekeeper deliberately stays in the path so that every request is inspected before it reaches the data. Azure's valet key guidance names the cases where a valet key fits poorly, such as data that must be validated before it is stored or uploads whose size must be limited; that is gatekeeper territory. The two also combine: the gatekeeper can be the place where clients ask for a valet key.
- **[API gateway](../api-gateway/) and [gateway offloading](../gateway-offloading/).** An API gateway often plays the gatekeeper's role, and Azure lists gateway offloading and gateway routing among the related patterns. The intent differs: offloading moves shared concerns such as TLS, authentication and logging to the edge for consistency, while a gatekeeper is a security boundary. A gateway is a gatekeeper only if it holds no data-store credentials, the services behind it can't be reached any other way, and it validates request content, not just headers and tokens.
- **[Zero trust access](../zero-trust-access/)** says that network location grants no trust. A gatekeeper fits that model as long as nobody treats it as a reason to trust everything behind it: the trusted host still authenticates the gatekeeper and revalidates every request.
- **[Federated identity](../federated-identity/)**, also on Azure's list, keeps user credentials out of the gatekeeper: it validates tokens issued by an identity provider instead.

## When to use it

- Sensitive data or mission-critical operations behind an internet-facing endpoint: claims, payments, health records, administrative APIs.
- Services that parse complex untrusted input, above all file uploads, where a parser bug is plausible.
- When back-end services must never be exposed directly, and request validation should be owned and reviewed apart from the business code.

**When not to use it:**

- **Nothing sensitive behind it.** A public, read-only site or a stateless service that holds no secrets gains little from another tier.
- **Latency-critical paths,** where the extra hop and the validation time break the latency budget; Azure names this case.
- **The platform already provides the boundary.** When built-in controls of the back-end service meet the security and validation requirements without a dedicated tier (Azure's other exception), for example a managed API platform that validates the schema and keeps the back end private.
- **Bulk transfers that can be checked after they land.** A [valet key](../valet-key/) keeps the bytes out of your tiers, with scanning and quarantine afterwards.

## Trade-offs

- **Latency and cost.** An extra network hop and a full parse of every request; large bodies may be buffered twice.
- **Availability.** A new tier on the critical path, which must be replicated, monitored and scaled with traffic.
- **Contract drift.** The gatekeeper's rules duplicate the service's contract. When they diverge, it either rejects valid requests (a release breaks) or lets through what the service doesn't expect.
- **Scope creep.** Business rules ("only claims under review accept uploads") are tempting to add, but they need data, which the gatekeeper must not have. Azure is explicit that it only validates and sanitises.
- **False confidence.** A gatekeeper shrinks the attack surface; it doesn't make the trusted host's code safe.
- **Harder debugging.** A request crosses two components, so a failure can be in either; correlation IDs and consistent error codes help.

## Implementation notes

- **One contract, two enforcers.** Keep the schema (OpenAPI, JSON Schema) in one place, generate the gatekeeper's validation from it, validate the same version on the trusted host, and release the two together.
- **Start in detection mode.** Run WAF rules in detection mode, read the logs, add exclusions, then switch to prevention. Give your own rules a log-only switch for the same purpose.
- **Fail closed.** When the gatekeeper can't evaluate a request (a parser error, a timeout, a body beyond its inspection limit), reject it. On AWS WAF, choose the oversize handling for every rule that inspects bodies on purpose; outside the console the default is to continue with what fits.
- **Keep it small and boring.** A minimal image, no shell or package manager, a read-only file system, no outbound internet access, and fast patching: it is the part of the system that attackers can reach.
- **Return little.** Answer with the status code (`400`, `413`, `415 Unsupported Media Type`) and a correlation ID, not the rule that fired; the details belong in the log.
- **Test the boundary.** From the internet, check that the trusted host and the stores don't answer; from the gatekeeper, that only the one port on the trusted host does; and that the trusted host rejects requests that skipped validation. Repeat after every network change.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Private Endpoints](../private-endpoints/) — Reach managed cloud services over private IPs instead of the public internet.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [Hub-and-Spoke Network](../hub-spoke-network/) — Shared services and egress in a central hub network; workloads live in peered spokes.

## References

- [Azure Architecture Center — Gatekeeper pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/gatekeeper)
- [OWASP Cheat Sheet Series — Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP Cheat Sheet Series — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Microsoft Learn — What is Azure Web Application Firewall on Azure Application Gateway?](https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/ag-overview)
- [Microsoft Learn — Web Application Firewall request and file upload size limits](https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/application-gateway-waf-request-size-limits)
- [Microsoft Learn — Application Gateway V1 retirement and migration to V2](https://learn.microsoft.com/en-us/azure/application-gateway/v1-retirement)
- [AWS WAF Developer Guide — AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html)
- [AWS WAF Developer Guide — Oversize web request components in AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-oversize-request-components.html)
- [Microsoft Learn — API Management policy reference: validate-content](https://learn.microsoft.com/en-us/azure/api-management/validate-content-policy)
- [Azure Architecture Center — Valet Key pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/valet-key)
- [RFC 9110 — HTTP Semantics (400, 413 and 415 status codes)](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 9112 — HTTP/1.1, section 11.2: Request Smuggling](https://www.rfc-editor.org/rfc/rfc9112#section-11.2)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
