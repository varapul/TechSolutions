<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# NGINX

> A reverse proxy and web server: TLS termination, load balancing, caching and rate limiting in front of applications.

<p align="center"><img src="diagram.svg" alt="Animated diagram: NGINX" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/nginx.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Every request for **shop.example** reaches NGINX first. It terminates TLS on port 443 with the site's certificate, serves `location /static/` from local disk, and passes `location /api/` to the upstream **catalog**, three app servers that speak plain HTTP on port 8080, with a 60 s cache for product responses and a limit of 10 requests a second per client IP. It is the job an ingress controller does in Kubernetes, and a cloud load balancer often sits in front of it. |
| **2 · Event-driven workers** | The **master process** reads `nginx.conf` and, with `worker_processes auto`, starts one **worker** per CPU core, four here. Each worker serves all of its connections from one event loop (epoll on Linux), not a thread per connection. `GET /api/products/42` is decrypted, matched to `location /api/products/` (the longest matching prefix; a cache MISS) and sent by `least_conn` to **app-2**, which has the fewest active connections, over a kept-alive connection; the 200 comes back and is cached for 60 s. |
| **3 · Cache, limits, failures** | The mobile app asks for `/api/products/42` within the 60 s, so NGINX answers from **proxy_cache** (a HIT) and no app server is called. The scraper at 203.0.113.7 sends more than 10 requests a second; the excess waits in a queue of 20 (`burst=20`), and once it is full the next request is rejected with **429** (set by `limit_req_status`; the default is 503). **app-2** refuses `GET /api/reviews/42`, its third failure within 10 s (`max_fails=3 fail_timeout=10s`), so NGINX skips it for 10 s and passes the request on to **app-3**. |
| **4 · Reload, and the limits** | `nginx -s reload` sends HUP to the master, which checks the new configuration, starts new workers with it and asks the old ones to shut down gracefully: they stop accepting connections, finish the requests they are serving and exit. The limits: configuration is mostly static, so a new upstream server means a reload (or DNS re-resolution with the `resolve` parameter; the NGINX Plus API changes upstreams without one), active health checks are an NGINX Plus feature, and rich per-request policy such as per-key quotas or request transformation is easier in an API gateway or Envoy. |
<!-- END GENERATED: header -->

## The problem

Acme Shop serves its storefront at shop.example: JavaScript, CSS and images that only change with a deploy, and an API that runs on three app servers. Every browser and every copy of the mobile app connects over HTTPS, so something has to hold the certificate and do the TLS handshakes. Something also has to spread API calls over the three servers and stop sending them to one that fails, answer the same popular product request without asking an app server each time, and slow down a scraper before it slows down everyone else. Building all of that into each app server repeats the work three times and puts the apps directly on the internet.

NGINX does these jobs in one process in front of the apps: it is a web server, a reverse proxy, a load balancer and a content cache. NGINX Open Source is distributed under the 2-clause BSD licence; F5 sells a commercial edition, NGINX Plus, with extra modules and support. Versions on this page are those of October 2026: the **stable** branch is 1.30 (1.30.5, released on 15 September 2026) and the **mainline** branch, where new features arrive first, is 1.31 (1.31.6, the same day).

## How it works

**One master, several workers.** The master process reads and checks `nginx.conf`, opens the listening sockets and starts the worker processes; it never handles a request itself. `worker_processes auto` starts one worker per CPU core (the built-in default is a single worker). The workers share the listening sockets and accept connections directly. Each worker is single-threaded and runs one event loop over all of its connections with the operating system's readiness API (epoll on Linux, kqueue on FreeBSD and macOS): it serves whichever socket is ready, moves that request one step on, and never sits waiting on a slow client or a slow upstream. A connection costs a file descriptor and some memory, not a thread; nginx.org puts 10,000 idle keep-alive connections at about 2.5 MB. `worker_connections` caps the connections of one worker (512 by default), upstream connections included, and the process's open-file limit caps it again. When a cache is configured, a cache loader and a cache manager process run as well.

**Contexts.** `nginx.conf` is built from simple directives (`name value;`) and block directives (`name { … }`) that nest into contexts. The main context holds `worker_processes` and the `events` and `http` blocks; `http` holds `upstream` groups and `server` blocks, one per virtual server; a `server` holds `location` blocks, which can nest. Most directives are inherited from the enclosing context unless the inner one sets them, and some only when the inner level sets none of that kind at all: one `proxy_set_header` in a location drops every `proxy_set_header` it would otherwise inherit.

**Which server, which location.** NGINX first picks a `server` by listening address and port, then by the `Host` header, and falls back to the `default_server` of that port. Inside it, the location is chosen by the request URI:

1. An exact match (`location = /`) ends the search.
2. Otherwise the longest matching prefix is remembered; if it is marked `^~`, the search ends there.
3. Regular-expression locations (`~`, `~*`) are tried in the order they appear, and the first match wins.
4. Predicate locations (`location $variable`, new in mainline 1.31.5) are tried next.
5. If nothing else matched, the remembered prefix is used.

So `GET /api/products/42` lands in `location /api/products/` rather than `/api/`: both prefixes match and the longer one wins.

**Load balancing.** An `upstream` block names a group of servers, and `proxy_pass http://catalog` sends requests to it.

| Method | How the server is picked | Notes |
|---|---|---|
| weighted round robin | in turn, by `weight` | the default |
| `least_conn` | fewest active connections, by weight | suits requests of uneven length |
| `ip_hash` | hash of the client address (first three octets of IPv4) | a client keeps its server |
| `hash key [consistent]` | hash of any key, such as `$request_uri` | `consistent` (ketama) remaps only a few keys when a server is added or removed |
| `random [two [least_conn]]` | random by weight; `two` draws two and takes the less busy | since 1.15.1 |
| `least_time` | lowest average response time and fewest active connections | open source since mainline 1.31.0; NGINX Plus only before |

Session affinity (the `sticky` directive with its cookie, route and learn methods, plus the `route` and `drain` server parameters) moved from NGINX Plus to open source in 1.29.6, so 1.30 has it.

**Passive health checks and retries.** Open-source NGINX learns that a server is failing from real traffic. With `max_fails=3 fail_timeout=10s`, three failed attempts within 10 seconds make a server unavailable for the next 10 seconds (the defaults are 1 and 10 s). `proxy_next_upstream` defines both what counts as a failure and when to try the next server. Connection errors, timeouts and invalid responses always count; 500, 502, 503, 504 and 429 count only if listed; 403 and 404 never do. By default a request is passed to the next server after an error or a timeout, but only while nothing has been sent to the client yet, and since 1.9.13 a POST, LOCK or PATCH that already reached an upstream is not resent unless you add `non_idempotent`. `proxy_next_upstream_tries` and `proxy_next_upstream_timeout` bound the retries. A group with a single server never marks it unavailable.

**Keep-alive to the upstream.** Since 1.29.7, and so in 1.30, each worker keeps up to 32 idle connections per upstream group by default (`keepalive 32 local`) and talks HTTP/1.1 to it (`proxy_http_version 1.1`). Before, you had to configure both and clear the `Connection` header yourself. Reusing a connection saves a TCP handshake, and a TLS handshake when the upstream is HTTPS, on every request. The proxy module can also speak HTTP/2 to upstreams since 1.29.4. By default (`proxy_buffering on`) NGINX reads the upstream's response into buffers as fast as it comes, spilling to a temporary file if needed, so the app server is free again while a slow client is still downloading.

**TLS, HTTP/2 and HTTP/3.** `listen 443 ssl` with `ssl_certificate` and `ssl_certificate_key` makes NGINX the TLS endpoint: the app servers see plain HTTP, or a new TLS connection if `proxy_pass https://…` re-encrypts. Since 1.27.3 only TLS 1.2 and 1.3 are enabled by default. HTTP/2 is switched on per server with `http2 on;` (since 1.25.1; the `http2` parameter of `listen` is deprecated). HTTP/3 over QUIC has been available since 1.25.0 with `listen 443 quic reuseport`; nginx.org still calls the `ngx_http_v3_module` experimental. It is not built from source by default (`--with-http_v3_module`), but nginx.org's Linux packages include it, and OpenSSL 3.5.1 or newer is recommended (older OpenSSL falls back to a compatibility layer without 0-RTT). `ssl_verify_client` asks clients for certificates, for [mutual TLS](../mutual-tls/). The separate `ngx_http_acme_module` ([nginx/nginx-acme](https://github.com/nginx/nginx-acme)) obtains and renews certificates over ACME.

**Proxy caching.** `proxy_cache_path` declares a cache. Responses are stored as files on disk, named by the MD5 of the cache key, while the keys and their metadata sit in a shared memory zone that every worker reads (about 8,000 keys per megabyte). `proxy_cache` switches it on for a location and `proxy_cache_valid 200 60s` keeps successful responses for 60 seconds. The default key is `$scheme$proxy_host$request_uri`, and only GET and HEAD responses are cached unless `proxy_cache_methods` says otherwise. The upstream can set the lifetime itself with `X-Accel-Expires`, `Expires` or `Cache-Control`, which take precedence over `proxy_cache_valid`; a response with `Set-Cookie` is not cached, and `Vary` splits the entry by request header. `$upstream_cache_status` reports MISS, BYPASS, EXPIRED, STALE, UPDATING, REVALIDATED or HIT. `proxy_cache_lock on` lets one request fill a missing entry while the others wait for it, and `proxy_cache_use_stale error timeout updating` serves the old copy while the upstream is down or being asked for a new one.

**Rate and connection limits.** `limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s` keeps one state per client address in shared memory; a state takes 128 bytes on 64-bit platforms, so a megabyte holds about 8,000 addresses. `limit_req zone=perip burst=20` lets requests above 10 a second wait in a queue of up to 20 and releases them at the configured rate (the module describes this as a leaky bucket). Past that, the request is rejected with 503, or with the status set by `limit_req_status`, 429 here. `nodelay` serves the burst at once instead of spacing it out, and `delay=` mixes the two; `limit_req_dry_run on` only counts. `limit_conn` caps concurrent connections per key in the same way. Each zone belongs to one NGINX instance: two instances count separately, and synchronising zones across a cluster (`sync`) is an NGINX Plus feature.

**Static files and compression.** `root /var/www` maps `/static/app.js` to `/var/www/static/app.js`; `alias` replaces the location's prefix instead, and `try_files` tries a list of paths before falling back. `sendfile on` (off by default) lets the kernel copy a file to the socket. Compression is off until `gzip on`, and `gzip_types` lists only `text/html` by default, so add JSON, CSS and JavaScript; `gzip_static` serves files compressed at build time.

**WebSockets.** `Upgrade` and `Connection` are hop-by-hop headers, so a location that proxies WebSockets passes them on explicitly (`proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`). When the upstream answers 101, NGINX turns the request into a two-way tunnel; this has worked since 1.3.13.

**Health checks: open source and NGINX Plus.** Open source has the passive checks above, which need real requests to notice a failure. NGINX Plus adds active checks (`health_check`, by default every 5 seconds), a `slow_start` ramp for a recovered server, an API that adds and removes upstream servers without a reload, and a status dashboard. Open source does offer `stub_status` for basic counters (active, reading, writing and waiting connections, accepted and handled connections, requests).

**Reload and binary upgrade.** `nginx -s reload` sends HUP to the master. The master checks the new configuration and opens any new log files and listening sockets; if that fails it keeps running the old configuration. If it succeeds, it starts new workers with the new configuration and asks the old workers to shut down gracefully: they close their listening sockets, finish the requests they hold and exit. Long-lived connections such as WebSockets keep an old worker alive until they end, unless `worker_shutdown_timeout` closes them. Replacing the binary itself works the same way: USR2 starts a new master with the new executable next to the old one, WINCH tells the old workers to finish, and QUIT retires the old master once the new one is trusted. Mainline 1.31.5 adds a Control API, a REST interface in the master (built with `--with-control-api`, started with `nginx -l unix:/path/to.sock`) that lists worker processes, returns the loaded configuration and triggers reloads; it does not change upstreams.

**In Kubernetes.** Two different projects carry the name. The community **ingress-nginx** controller, maintained under Kubernetes SIG Network, was retired: maintenance ended in March 2026, its repository was archived on 24 March 2026, and it gets no further releases or security fixes. Existing installations keep running, and Kubernetes SIG Network recommends moving to the Gateway API or another ingress controller. **F5 NGINX Ingress Controller** (nginx/kubernetes-ingress, Apache 2.0) is a separate controller made by F5 that runs NGINX Open Source or NGINX Plus, and **NGINX Gateway Fabric** implements the Gateway API with NGINX as the data plane.

**Licence and forks.** NGINX Open Source is under the 2-clause BSD licence and its source lives on GitHub (nginx/nginx). NGINX Plus is commercial. freenginx is a fork that describes itself as an effort to keep nginx's development free and open, under the same BSD-style licence.

## Where it fits

- **Solutions:** the front door of websites and APIs (TLS, static files, proxying to app servers), an origin cache behind a CDN, an internal load balancer between tiers, a reverse proxy in front of PHP-FPM, uWSGI or gRPC services, and the data plane of Kubernetes ingress and Gateway API controllers.
- **Patterns in this catalog it implements or supports:** [Load Balancing](../load-balancing/) with `upstream` groups and passive checks; [Gateway Offloading](../gateway-offloading/) of TLS, compression and caching; [Rate Limiting](../rate-limiting/) with `limit_req` and `limit_conn`; the origin tier of [CDN & Edge Caching](../cdn-edge-caching/), or a small self-run cache tier; [Mutual TLS](../mutual-tls/) with `ssl_verify_client`; [Health Endpoint Monitoring](../health-endpoint-monitoring/), passively in open source and with active probes of a health URL in NGINX Plus; [Blue-Green Deployment](../blue-green-deployment/) and [Canary Release](../canary-release/) by switching or weighting upstream servers and reloading; and a [Strangler Fig](../strangler-fig/) migration that routes one path at a time to the new system. It can act as a simple [API Gateway](../api-gateway/) for routing and limits. In [Kubernetes](../kubernetes/) an ingress or Gateway API controller plays this role.
- **Usual neighbours:** browsers, mobile apps and CDNs in front; often a cloud network load balancer in front of two or more NGINX instances for availability; app servers, PHP-FPM and gRPC services behind; certificates from an ACME CA or a secrets store; access logs shipped to a log pipeline and `stub_status` scraped for metrics.
- **Managed offerings:** AWS does not run NGINX as a managed service of its own. You run it yourself on EC2, [ECS](../amazon-ecs/) or EKS, or buy NGINX Plus as an AMI through AWS Marketplace. The managed AWS services for the same jobs are the **Application Load Balancer** (layer-7 routing, health checks, TLS with certificates from AWS Certificate Manager), **CloudFront** (caching at the edge), **AWS WAF** rate-based rules (rate limiting) and **Amazon API Gateway** (throttling and API management). On Azure, **F5 NGINXaaS for Azure** is a managed service built on F5's commercial NGINX.

## When to use it

Use NGINX when one process should do the edge work for a site or an API that you run yourself: TLS, static files, caching, rate limits and load balancing across a fixed or slowly changing set of servers. Choose something else when upstreams change by the minute and you need an API instead of reloads, when you want active health checks without paying for NGINX Plus, or when you would rather not run the edge at all.

| | NGINX Open Source | HAProxy | Envoy | Caddy, Traefik | AWS ALB |
|---|---|---|---|---|---|
| What it is | web server, reverse proxy, load balancer and cache | reverse proxy and load balancer for TCP and HTTP | layer-7 proxy designed for large service-oriented systems and service meshes | Caddy: web server; Traefik: reverse proxy that configures itself | managed layer-7 load balancer |
| Changing upstreams | edit the file and reload; DNS with `resolve`; an API in NGINX Plus | runtime API adds and removes servers, and since 3.4 whole backends, without a reload | dynamic discovery APIs (xDS) from a control plane | Caddy: JSON admin API; Traefik: follows [Docker](../docker/), Kubernetes and other providers | API or console; targets registered by Auto Scaling or ECS |
| Health checks | passive (active in NGINX Plus) | active checks | active checks plus outlier detection | active and passive (Caddy) | active, per target group |
| Response cache | built in, on disk | small cache | cache filter | — | none (CloudFront in front) |
| Certificates | files, or the ACME module | files, ACME since 3.2 | files, or pushed by the control plane | automatic HTTPS through ACME | AWS Certificate Manager |
| Licence | 2-clause BSD | GPLv2, LGPL headers | Apache 2.0 | Apache 2.0 (Caddy), MIT (Traefik) | a managed service |
| Choose it when | you want one process for TLS, files, caching and proxying | load balancing is the whole job and you want runtime changes and active checks in open source | you run many services, want dynamic configuration and rich telemetry, often with a mesh | small sites that should get certificates on their own, or containers that come and go | you are on AWS and want it managed, with AWS WAF and ACM |

## Trade-offs

- **Configuration is static.** Changes go through a file and a reload. A reload doesn't drop requests, but frequent reloads leave old workers alive while long connections drain, and every change needs a deploy step. DNS re-resolution (`resolve`) covers servers behind a changing name, and the API for live upstream changes is an NGINX Plus feature.
- **Open-source health checks are passive.** A failure is noticed by a real request (retried on another server if it is safe), and a server marked down is tried again by real traffic once `fail_timeout` passes. Active checks, slow start and the status API are in NGINX Plus.
- **State is per instance.** The cache, the rate-limit zones and the failure counts live in one NGINX. Two instances each allow 10 r/s per client, and each warms its own cache.
- **The configuration language has sharp edges.** Location matching order, directives that inherit only when the inner level sets none, and the difference between `root` and `alias` cause many production surprises; test with `nginx -t` and keep the configuration in version control.
- **One instance is a single point of failure.** Run at least two, behind a cloud load balancer or a floating IP.
- **Not a full API gateway.** Per-key quotas, request transformation, developer portals and fine-grained authorization need modules, njs scripts or a dedicated gateway; Envoy-based gateways change routes through APIs.

## Implementation notes

The scenario's configuration (checked with `nginx -t` on nginx 1.30.5):

```nginx
# /etc/nginx/nginx.conf for shop.example (nginx 1.30 stable)
worker_processes auto;                 # one worker per CPU core; the default is 1

events {
    worker_connections 4096;           # per worker, upstream connections included; default 512
}

http {
    sendfile on;                       # static files go from disk to socket in the kernel

    limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s;
    proxy_cache_path /var/cache/nginx/api keys_zone=api_cache:10m
                     max_size=1g inactive=10m;

    upstream catalog {
        least_conn;
        server app-1:8080 max_fails=3 fail_timeout=10s;
        server app-2:8080 max_fails=3 fail_timeout=10s;
        server app-3:8080 max_fails=3 fail_timeout=10s;
        # keepalive 32 local;  is the default since 1.29.7
    }

    server {
        listen 80;
        server_name shop.example;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name shop.example;
        ssl_certificate     /etc/nginx/tls/shop.example.crt;
        ssl_certificate_key /etc/nginx/tls/shop.example.key;

        location /static/ {
            root /var/www;             # /static/app.js is /var/www/static/app.js
        }

        location /api/ {
            limit_req zone=perip burst=20;   # past 10 r/s, up to 20 wait
            limit_req_status 429;            # the default is 503
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_pass http://catalog;

            location /api/products/ {        # longest prefix wins
                proxy_cache api_cache;
                proxy_cache_valid 200 60s;
                add_header X-Cache-Status $upstream_cache_status;
                proxy_pass http://catalog;
            }
        }
    }
}
```

The nested `location /api/products/` inherits the rate limit and the `proxy_set_header` lines from `/api/` but needs its own `proxy_pass`. Without `proxy_set_header Host $host` the app servers would see `Host: catalog`, the name of the upstream group. Upstream host names such as `app-1` are resolved once, when the configuration loads, unless the group has a `zone`, a `resolver` is set and the servers carry `resolve`.

- **Test, then reload.** `nginx -t` checks syntax and files without touching the running server; `nginx -s reload` then applies the change. A failed reload leaves the old configuration running, so check the error log after each one.
- **Find the real client address.** Behind a cloud load balancer every connection comes from the balancer, so `$binary_remote_addr` would put all clients in one rate-limit bucket. The realip module (`set_real_ip_from` with the balancer's addresses, plus `real_ip_header X-Forwarded-For` or the PROXY protocol) restores the client's address.
- **Log the upstream side.** Add `$upstream_addr`, `$upstream_status`, `$upstream_response_time` and `$upstream_cache_status` to the `log_format`: they show which server answered, how long it took, which attempt failed before a retry, and whether the cache helped.
- **Size the limits.** `worker_connections` times the number of workers bounds open connections, and each proxied request uses two (client and upstream). Raise the open-file limit (`worker_rlimit_nofile`) with it.
- **Plan for long-lived connections.** WebSockets and streaming responses keep old workers alive after a reload; set `worker_shutdown_timeout` if reloads are frequent.
- **Keep it patched.** NGINX parses untrusted input on the internet edge, and both branches ship security fixes regularly (several CVEs were fixed in 2026); follow the stable branch unless you need a mainline feature.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Load Balancing](../load-balancing/) — Spread requests across healthy instances and stop sending to unhealthy ones.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.
- [Rate Limiting & Throttling](../rate-limiting/) — Cap how fast each client may call (token bucket) and shed the excess with 429s.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Health Endpoint Monitoring](../health-endpoint-monitoring/) — Expose liveness and readiness checks that load balancers and monitors probe.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.

## References

- [nginx.org — Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html)
- [nginx.org — Controlling nginx (reload and binary upgrade)](https://nginx.org/en/docs/control.html)
- [nginx.org — Connection processing methods](https://nginx.org/en/docs/events.html)
- [nginx.org — Core functionality (worker_processes, worker_connections)](https://nginx.org/en/docs/ngx_core_module.html)
- [nginx.org — Module ngx_http_core_module (location matching)](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [nginx.org — How nginx processes a request](https://nginx.org/en/docs/http/request_processing.html)
- [nginx.org — Module ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [nginx.org — Using nginx as HTTP load balancer](https://nginx.org/en/docs/http/load_balancing.html)
- [nginx.org — Module ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [nginx.org — Module ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [nginx.org — Module ngx_http_limit_conn_module](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)
- [nginx.org — Module ngx_http_realip_module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)
- [nginx.org — Module ngx_http_gzip_module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [nginx.org — Module ngx_http_stub_status_module](https://nginx.org/en/docs/http/ngx_http_stub_status_module.html)
- [nginx.org — Module ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [nginx.org — Support for QUIC and HTTP/3](https://nginx.org/en/docs/quic.html)
- [nginx.org — Module ngx_http_v3_module](https://nginx.org/en/docs/http/ngx_http_v3_module.html)
- [nginx.org — Module ngx_http_acme_module](https://nginx.org/en/docs/http/ngx_http_acme_module.html)
- [nginx.org — WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [nginx.org — Changes in the mainline branch (1.31.6, September 2026)](https://nginx.org/en/CHANGES)
- [nginx.org — Changes in the stable branch (1.30.5, September 2026)](https://nginx.org/en/CHANGES-1.30)
- [nginx.org — License (2-clause BSD)](https://nginx.org/LICENSE)
- [freenginx — about the fork](https://freenginx.org/en/)
- [NGINX Documentation — Control NGINX Processes at Runtime (Control API)](https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/)
- [NGINX Documentation — HTTP Health Checks](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-health-check/)
- [NGINX Documentation — Dynamic Configuration of Upstreams with the NGINX Plus API](https://docs.nginx.com/nginx/admin-guide/load-balancer/dynamic-configuration-api/)
- [Owen Garrett — Inside NGINX: How We Designed for Performance & Scale (NGINX blog, 2015)](https://blog.nginx.org/blog/inside-nginx-how-we-designed-for-performance-scale)
- [Andrew Alexeev — nginx, in The Architecture of Open Source Applications, Volume II](https://aosabook.org/en/v2/nginx.html)
- [Kubernetes blog — Ingress NGINX Retirement: What You Need to Know (November 2025)](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [GitHub — kubernetes/ingress-nginx (archived March 2026)](https://github.com/kubernetes/ingress-nginx)
- [NGINX Documentation — F5 NGINX Ingress Controller](https://docs.nginx.com/nginx-ingress-controller/)
- [NGINX Documentation — F5 NGINXaaS for Azure](https://docs.nginx.com/nginxaas-azure/)
- [NGINX Documentation — Installing NGINX Plus AMIs on Amazon EC2](https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-plus-amazon-web-services/)
- [AWS — What is an Application Load Balancer?](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [AWS WAF Developer Guide — Using rate-based rule statements in AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)
- [HAProxy — project home page (features, news and release notes)](https://www.haproxy.org/)
- [HAProxy — LICENSE (GPL with LGPL headers)](https://github.com/haproxy/haproxy/blob/master/LICENSE)
- [Envoy documentation — What is Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy)
- [Envoy documentation — xDS REST and gRPC protocol](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
- [Envoy documentation — Cache filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/cache_filter)
- [Caddy documentation — Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy documentation — reverse_proxy (health checks)](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Caddy documentation — API](https://caddyserver.com/docs/api)
- [Traefik documentation — Providers](https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
