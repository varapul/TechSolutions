<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Mutual TLS (mTLS)

> Client and server both present certificates, so every connection is authenticated both ways.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Mutual TLS (mTLS)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/mutual-tls.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · One-way TLS** | In ordinary TLS only the server presents a certificate. It sends `Certificate` and a `CertificateVerify` signature that proves it holds the matching private key, and the client checks the chain against its trust store. The channel is encrypted and the client knows who the server is, but the server has learnt nothing about the caller: at this layer the client is anonymous. |
| **2 · Both sides authenticate** | With mutual TLS the server adds a `CertificateRequest` to its flight. The client answers with its own `Certificate` and a `CertificateVerify` signed with its private key, which proves possession. The server checks the chain to a trusted CA, the validity dates and revocation, then reads the caller's identity from the subject alternative name (here `spiffe://example.org/orders`). |
| **3 · Rejected at the handshake** | Three other clients try in turn: one has no certificate, one presents a certificate that expired hours ago, one presents a certificate issued by a CA the server does not trust. Each handshake ends with a TLS alert (`certificate_required`, `certificate_expired`, `unknown_ca`) and the connection is closed before any application request is read. |
| **4 · Short-lived, auto-rotated** | Certificates are issued for hours or days, and an automated issuer replaces each one well before it expires, so nobody renews anything by hand and a stolen key is soon useless. Mutual TLS only answers **who is calling**: an authorization policy still has to decide what that identity may do. |
<!-- END GENERATED: header -->

## The problem

Ordinary TLS answers one question: is this really the server I meant to reach? The server presents a certificate, the client checks it, and the channel is encrypted from then on. The server learns nothing about who is on the other end. At the TLS layer, every client is anonymous.

Services fill that gap in ways that age badly. Some trust the network: whatever can reach the port, or comes from the right subnet, is treated as a friend. That is the implicit trust that zero trust architecture (NIST SP 800-207) sets out to remove, and one compromised host inside the perimeter inherits all of it. Others give each caller a shared secret, an API key or a password in a header. It is the same string on every request, it ends up in configuration files and logs, and whoever copies it can use it from anywhere until somebody notices.

Mutual TLS gives the server the assurance the client already has. Both ends prove who they are with a certificate and a private key during the handshake, before any application data is exchanged. No secret crosses the wire, and the identity is tied to the connection instead of to a string that can be replayed.

## How it works

**What the handshake adds.** The message names below are those of TLS 1.3, specified in RFC 9846, a backward-compatible revision that replaced RFC 8446 in July 2026. A one-way handshake already carries the server's `Certificate`, `CertificateVerify` and `Finished`. Mutual TLS adds three messages:

- **`CertificateRequest`**, sent by the server straight after its `EncryptedExtensions`. It says that a client certificate is wanted and which signature algorithms are acceptable. It can also list the CAs the server accepts (the `certificate_authorities` extension), which helps a client that holds several certificates to pick the right one.
- **`Certificate`**, from the client: its certificate, plus any intermediates. A client that has nothing suitable must still answer, with an empty list.
- **`CertificateVerify`**, from the client: a signature over the transcript of the handshake so far, made with the private key that matches the certificate. This is the proof of possession. A certificate is public, so presenting one proves nothing by itself; only the key holder can produce the signature, and because it covers this handshake's transcript it is useless on any other connection.

Each side closes with `Finished`. In TLS 1.3 everything after `ServerHello` is encrypted, so the certificates, and the identities in them, are hidden from anyone watching the network. In TLS 1.2 they crossed in the clear.

Asking for a certificate and insisting on one are separate decisions, and TLS leaves the second to the server: faced with an empty list or a chain it does not accept, it may abort the handshake, or carry on and treat the client as unauthenticated. Server software therefore exposes this as a setting. nginx's `ssl_verify_client` takes `on` or `optional`, Go's `tls.Config` distinguishes `RequestClientCert` from `RequireAndVerifyClientCert`, and Envoy has `require_client_certificate`. The server in the diagram requires one.

**Trust.** A certificate is believed because a CA in the verifier's trust store signed it. For mutual TLS that should be your own CA, a private CA or internal PKI, and the trust store for client certificates should hold nothing else:

- *The trust store defines who can get in.* A server accepts any client whose chain ends at a CA it trusts. If the public web roots are in there, anyone who can obtain a certificate from any public CA passes the chain check. With a private CA, the possible callers are exactly the certificates you issued.
- *Public CAs are leaving client authentication.* Chrome's root program requires the hierarchies it trusts to be dedicated to TLS server authentication, and certificates issued under them from 15 March 2027 may assert only the server authentication extended key usage (EKU). CAs have moved ahead of that date: Let's Encrypt took the client authentication EKU out of its default profile in February 2026 and ended the last profile that carried it on 8 July 2026. A publicly trusted certificate can no longer be expected to work as a client certificate.

**Identity.** The verifier reads who the peer is from the certificate's **subject alternative name** (SAN). The common name is not used: the current rules for checking a service's identity in TLS (RFC 9525) forbid it. A server's SAN is usually a DNS name. A workload's is often a URI, and **SPIFFE** standardises that form: a SPIFFE ID such as `spiffe://example.org/orders` consists of a trust domain and a path, and an X.509-SVID is a certificate that carries exactly one of them as its only URI SAN. SVIDs that set an EKU list both server and client authentication, which suits a service that is the client on one connection and the server on the next.

**Validation.** Each side runs the same checks on the other's certificate, and a failure ends the handshake with an alert. The first three are the path validation of RFC 5280:

1. **Chain.** Every signature verifies, from the peer's certificate through any intermediates to a CA in the trust store.
2. **Validity dates.** The current time lies inside the `notBefore` to `notAfter` window of every certificate in the chain.
3. **Revocation.** No certificate in the chain has been withdrawn by its issuer, according to a certificate revocation list (CRL) or an OCSP response (RFC 6960).
4. **Possession.** The `CertificateVerify` signature verifies with the certificate's public key.
5. **Identity.** The SAN is the one this endpoint expects (a client checking a server), or is handed to the authorization layer (a server checking a client).

Step 3 of the diagram shows three ways to fail: no certificate at all (`certificate_required`), a certificate past its `notAfter` (`certificate_expired`) and a chain that ends at a CA outside the trust store (`unknown_ca`).

Revocation is the weak step. Both mechanisms need the verifier to hold fresh data from the CA at the moment of the handshake, which is one more thing to distribute and one more thing that can fail. Current practice is to let the certificate expire before revocation could matter. RFC 9608 describes exactly that: CAs that issue short-lived certificates publish no revocation information for them, since such a certificate expires before news of a revocation could reach the verifiers, and it defines an extension (`noRevAvail`) that tells verifiers to skip the check. The public web is heading the same way: Let's Encrypt switched off its OCSP responders in August 2025 and has offered six-day certificates since January 2026. Inside a platform, lifetimes between an hour and a day are normal.

**Issuing and rotating.** Short lifetimes only work when nobody has to do anything. An automated issuer gives every workload its certificate and replaces it well before it expires:

- **SPIRE** attests the node and the workload, then delivers an X.509-SVID over a local API. The default lifetime is one hour, and the agent renews at half of it.
- **cert-manager** issues from a `Certificate` resource in Kubernetes and by default renews two-thirds of the way through the lifetime. Its SPIFFE CSI driver mounts one-hour certificates whose private key never leaves the node.
- **ACME** (RFC 8555) is the protocol Let's Encrypt made common, and private CAs speak it too (step-ca is one), so ordinary ACME clients can renew internal certificates.
- A **[service mesh](../service-mesh/)** does all of this on the application's behalf. In Istio the agent next to each proxy generates the key and a signing request, the control plane signs it, and the certificate lasts 24 hours by default. Linkerd's proxies get 24-hour certificates as well.

The diagram's one-hour certificates, replaced at two-thirds of their life, are one such configuration. A renewal should bring a new key pair, not a new certificate for the old key, or a stolen key simply outlives the certificate it was stolen with. cert-manager has rotated the key by default since v1.18.

## When to use it

- **Service to service, inside a platform.** Both ends are software you deploy, so both can be given certificates automatically. This is where mutual TLS is at its best, and a service mesh turns it on by default.
- **Devices and agents:** gateways, IoT devices, build runners, anything that has somewhere to keep a key and no person to type a password.
- **Partner and business-to-business APIs,** where each partner gets a certificate, or registers its own, instead of sharing an API key.
- **OAuth clients** (RFC 8705). A confidential client can authenticate to the token endpoint with its certificate in place of a client secret, validated through a PKI (`tls_client_auth`) or registered as a self-signed certificate (`self_signed_tls_client_auth`). The same RFC defines **certificate-bound access tokens**: the authorization server writes the SHA-256 thumbprint of the certificate into the token (`cnf.x5t#S256`), and the API accepts the token only over a connection made with that certificate, so a stolen token is worthless without the key. The FAPI 2.0 Security Profile, written first for financial APIs, requires every access token to be sender-constrained, with mutual TLS or with DPoP. OAuth 2.0 Client Credentials is the grant this usually goes with, and [JWT Validation](../jwt-validation/) covers the rest of what the API checks.
- **Not for people in browsers.** Browsers do support client certificates, but putting a certificate and key on every device a person uses is a provisioning problem, the certificate prompt confuses people, and there is no way to sign out. RFC 8705 keeps certificate-bound tokens out of the browser-facing implicit flow for that reason: it says client certificates in users' browsers bring operational and usability problems. HTTP/2 adds a hard limit: a server cannot ask for a certificate part-way through a connection, because RFC 9113 forbids TLS 1.3 post-handshake authentication and TLS 1.2 renegotiation, so it is all or nothing for the whole connection. Sign people in with [OpenID Connect](../openid-connect/). Managed fleets are the exception: a certificate installed by device management identifies the laptop, and the person still signs in.

## Trade-offs

- **You now run a PKI.** Someone has to guard the CA key, issue to every workload, ship the trust bundle to every verifier and plan the rotation of the CA itself, which is much harder than rotating a leaf: old and new roots have to be trusted side by side until every certificate has been reissued.
- **Expiry is the classic outage.** A certificate that runs out breaks every connection that depends on it at the same moment. Automation removes the manual renewals but not the risk: the issuer can be unavailable for longer than the remaining lifetime, a process can go on serving the certificate it loaded at start-up while a fresh one sits on disk, and CA certificates expire too, on a timescale long enough for everyone to forget. Linkerd's default trust anchor and issuer certificate, for example, expire after a year and have to be rotated by hand unless you automate it. Alert on time to expiry at every level of the chain.
- **Clocks matter.** Validity is judged by the verifier's own clock. With one-hour certificates, a clock a few minutes out rejects a brand-new certificate as not yet valid, or goes on accepting an expired one.
- **Failures are hard to read.** A failed handshake ends in a terse TLS alert such as `certificate_required`, `certificate_expired` or `unknown_ca`, and what reaches the application is often less: a generic handshake error or a closed connection. In TLS 1.3 the client's certificate travels in the last flight of the handshake, so the client has finished its side before the server gives its verdict, and the rejection tends to surface on the first read or write rather than on connect. Log the exact validation error on the side that rejected.
- **TLS termination hides the certificate.** The identity belongs to the TLS connection and ends where TLS ends. Behind a load balancer or gateway that terminates TLS, the application sees a new connection from the proxy and no client certificate at all (see the implementation notes).
- **It says who, not what.** A valid certificate proves which workload is calling. It does not say whether that workload may read this record, and it says nothing about the end user on whose behalf the call is made. Mutual TLS is authentication, not authorization: it needs a policy on top, and usually a token beside it.
- **Checked once per connection.** Validation happens during the handshake and TLS does not repeat it later, so a connection that is already open usually keeps working after its certificate has expired or been revoked.

## Implementation notes

- **Trust only your own CA** for client certificates, and keep that trust store separate from the one used to verify public servers.
- **Authorize by identity.** Turn the SAN into a decision, such as "`spiffe://example.org/orders` may call `POST /payments`". In a mesh this is declarative (Istio's `AuthorizationPolicy` matches on the peer's principal); in application code it is a check on the verified peer certificate. Without it, a certificate from the right CA is all anyone needs, and every workload in the trust domain can call every other.
- **Roll out in two steps.** Accept both mutual TLS and plain connections first and watch who still connects without a certificate, then require it. Istio calls the two modes `PERMISSIVE`, its default, and `STRICT`.
- **Where TLS terminates.** With a proxy in front there are three options:
  - *Pass through.* A layer 4 load balancer forwards the TCP connection untouched and the application terminates TLS itself.
  - *Verify at the edge, forward the identity.* The proxy validates the client certificate and passes it on in a request header. RFC 9440 defines the `Client-Cert` and `Client-Cert-Chain` header fields for this; older, product-specific equivalents are Envoy's `x-forwarded-client-cert`, the `X-Amzn-Mtls-*` headers of AWS Application Load Balancers and whatever header you fill from nginx's `$ssl_client_escaped_cert`. The header is worth exactly as much as the hop it arrives on: the proxy must remove any copy the client sent, the backend must accept it from that proxy only, and the connection between the two must be protected. Forgetting to strip the header fails open: everything keeps working while any client can claim any identity.
  - *Mutual TLS on both hops.* The proxy authenticates the client, then opens its own mutually authenticated connection to the backend. The backend now knows the proxy, and learns about the original client only what the proxy tells it.

  Terminating TLS and checking client certificates in one place is gateway offloading, one of the jobs of an [API gateway](../api-gateway/).
- **Reload without a restart.** A process has to pick up a renewed certificate and key while it runs. Proxies and meshes do; an application that reads its files once at start-up will end up serving an expired certificate.
- **Cap connection lifetimes** at the server or the proxy, so that every connection is re-established, and its certificate validated again, within a bounded time.
- **Certificate-bound tokens and rotation.** A token bound to a certificate dies with it: after rotating its certificate the client has to fetch a new token (RFC 8705 §6.3). With hourly rotation that means a token request every hour at least; DPoP (RFC 9449) binds the token to a separate key instead.
- **Keep clocks in sync,** with NTP on every node.
- **Guard the key.** Generate it where it is used and never copy it: keep it in memory, in a volume that is never written to disk, or in hardware such as a TPM or an HSM. The certificate can be public; the key is the identity.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Service Mesh](../service-mesh/) — Sidecar proxies plus a control plane: mTLS, retries and traffic shifting without touching app code.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Gateway Offloading](../gateway-offloading/) — Move TLS termination, authentication and compression out of every service into the gateway.

## Related components and services

- [NGINX](../nginx/) — A reverse proxy and web server: TLS termination, load balancing, caching and rate limiting in front of applications.
- [HashiCorp Vault](../vault/) — A secrets manager: authenticate workloads, hand out short-lived credentials, encrypt data and audit every access.

## References

- [RFC 9846 — The Transport Layer Security (TLS) Protocol Version 1.3 (replaces RFC 8446)](https://www.rfc-editor.org/rfc/rfc9846)
- [RFC 5280 — Internet X.509 Public Key Infrastructure Certificate and Certificate Revocation List (CRL) Profile](https://www.rfc-editor.org/rfc/rfc5280)
- [RFC 9525 — Service Identity in TLS](https://www.rfc-editor.org/rfc/rfc9525)
- [RFC 9608 — No Revocation Available for X.509 Public Key Certificates](https://www.rfc-editor.org/rfc/rfc9608)
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705)
- [RFC 9440 — Client-Cert HTTP Header Field](https://www.rfc-editor.org/rfc/rfc9440)
- [RFC 9113 — HTTP/2 (§9.2.3 TLS 1.3 Features)](https://www.rfc-editor.org/rfc/rfc9113.html#section-9.2.3)
- [RFC 8555 — Automatic Certificate Management Environment (ACME)](https://www.rfc-editor.org/rfc/rfc8555)
- [SPIFFE — The X.509 SPIFFE Verifiable Identity Document (X509-SVID)](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md)
- [SPIFFE — SPIRE Concepts](https://spiffe.io/docs/latest/spire-about/spire-concepts/)
- [cert-manager — Certificate resource](https://cert-manager.io/docs/usage/certificate/)
- [Istio — Security (identity, mutual TLS, authorization)](https://istio.io/latest/docs/concepts/security/)
- [Linkerd — Automatic mTLS](https://linkerd.io/docs/features/automatic-mtls/)
- [Chrome Root Program Policy, Version 1.8](https://googlechrome.github.io/chromerootprogram/crp/policy/)
- [Let's Encrypt — Ending TLS Client Authentication Certificate Support in 2026](https://letsencrypt.org/2025/05/14/ending-tls-client-authentication)
- [OpenID Foundation — FAPI 2.0 Security Profile](https://openid.net/specs/fapi-security-profile-2_0-final.html)
- [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
