<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# HashiCorp Vault

> A secrets manager: authenticate workloads, hand out short-lived credentials, encrypt data and audit every access.

<p align="center"><img src="diagram.svg" alt="Animated diagram: HashiCorp Vault" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/vault.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's **Orders** service runs on Kubernetes, and its pods carry no passwords. A **Vault Agent** sidecar logs in to HashiCorp Vault with the pod's service-account token and receives secrets that expire: a PostgreSQL user that Vault creates on demand, and encryption done by Vault's **transit** engine. The platform team writes the **policies** and roles that decide who may read what, and an **audit device** records every request and response. Vault itself runs as a three-node cluster on **integrated storage (Raft)**, and AWS KMS unseals each node when it starts. |
| **2 · Log in, get a DB user** | The agent sends the pod's service-account token to the **Kubernetes auth method** (`auth/kubernetes/login`, role `orders`). Vault asks the Kubernetes API through the **TokenReview** API whether the token is valid and whose it is; it belongs to the service account `orders` in the namespace `shop`, which the role allows, so Vault returns a token (`hvs.…`) carrying the policy `orders-app` with a 1-hour TTL. With that token the agent reads `database/creds/orders-rw`: the policy allows `read`, the **database secrets engine** runs the role's `CREATE ROLE … VALID UNTIL` statement in PostgreSQL, and Vault returns the new user `v-orders-rw-8f2kq7xm` and its password under a 1-hour **lease**. |
| **3 · Leases and encryption** | The agent renews the lease once two-thirds of it has passed (40 minutes in), and each renewal gives another hour, but never beyond the role's `max_ttl` of 24 hours. At that limit the agent reads a new user, `v-orders-rw-k3m9x2pd`, and the old lease expires: Vault drops `v-orders-rw-8f2kq7xm` from PostgreSQL, so a leaked copy of its password stops working (`vault lease revoke` ends a lease at once, after a suspected leak). The Orders app then sends a card token to `transit/encrypt/orders-key` and stores the ciphertext; the key was just rotated, so new values start with `vault:v2:` while older `vault:v1:` rows still decrypt. The key never leaves Vault, only callers whose policy grants `transit/decrypt/orders-key` get plaintext back, and the audit log keeps HMAC-SHA256 hashes of the values instead of the values. |
| **4 · Limits and licences** | Vault sits on the critical path. Here the nodes restart while AWS KMS is unreachable, so they stay **sealed**: a new pod's login gets HTTP 503, while the running pod keeps working with its cached token and database user until the lease ends; once KMS answers, the nodes unseal by themselves. Plan for it with three or five nodes (Raft keeps a quorum with one of three down), Vault Agent caching, and great care for the KMS key (if it is deleted, the data can't be recovered, even from backups) or for the Shamir key shares. Vault 1.15 and later are under the **Business Source License 1.1** (announced August 2023), IBM completed its purchase of HashiCorp in February 2025, and **OpenBao** is the MPL 2.0 fork run under the Linux Foundation's OpenSSF. For static secrets and rotation, AWS Secrets Manager, Azure Key Vault or Google Secret Manager have fewer moving parts. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Orders service runs as pods on Kubernetes. Each pod needs a login for the PostgreSQL `orders` database, and the service keeps the card tokens it receives at checkout, which must not sit in the database as plain text. The quick answers all leave a long-lived secret lying around: a password in an environment variable or in a Kubernetes Secret (base64 in the manifest and, unless the cluster encrypts Secrets at rest, unencrypted in [etcd](../etcd/)), a password baked into the image, an encryption key in the application's configuration.

One shared password then ends up in every replica, in CI logs and on laptops. Nobody can tell who read it. Rotating it means changing the database and redeploying every service at the same moment, so it rarely happens, and a leaked copy keeps working for whoever holds it until someone notices. Each service that encrypts data also has to manage keys on its own, and does it differently.

What the shop wants instead: workloads that prove who they are with an identity their platform already gives them, credentials issued per workload that expire by themselves, keys that applications can use without ever holding them, and a record of every access.

## How it works

HashiCorp Vault is a server, usually run as a small cluster, that authenticates a client, checks the request against policies, and then hands out a secret or performs a cryptographic operation. Everything it keeps is encrypted before it reaches its storage. HashiCorp has been part of IBM since February 2025; the current release is Vault 2.1.1 (September 2026), after Vault moved from the 1.x line to 2.0 in April 2026.

### The barrier, the storage and the seal

- **Storage backend.** Vault keeps everything (configuration, policies, tokens, leases, KV secrets, transit keys) in a storage backend that it treats as untrusted. The recommended one is **integrated storage**: every node keeps a full copy on its own disk and the nodes stay in agreement through the Raft consensus protocol, so there is no separate database to run.
- **Barrier.** Between Vault's core and its storage sits the **encryption barrier**. Every value is encrypted on the way out with AES-256 in GCM mode, using a random 96-bit nonce per object, and its authentication tag is checked on the way back in. The data keys live in a keyring, and Vault rotates the barrier key by itself before it has performed about 2<sup>32</sup> encryptions with it, the limit NIST recommends for this mode.
- **Seal and unseal.** A Vault node starts **sealed**: it can reach its storage but can't decrypt anything. The keyring is encrypted with the **root key**, and the root key with an **unseal key**. By default `vault operator init` splits the unseal key with Shamir's Secret Sharing into 5 key shares, any 3 of which rebuild it, and operators enter shares on every node after every restart.
- **Auto-unseal.** With auto-unseal, a cloud KMS or an HSM protects the root key instead, and each node asks it to decrypt the root key when it starts. Initialization then returns **recovery keys**, which authorize a few sensitive operations, such as generating a new root token, but can't unseal Vault. A node that fails to auto-unseal keeps retrying every few seconds, so a KMS outage delays the start rather than breaking it, but the dependency is strict: if the KMS key is deleted, the data can't be recovered, not even from backups.

Acme Shop's three nodes run on Kubernetes with integrated storage and AWS KMS auto-unseal (the `vault.hcl` of `vault-0`; the other nodes use their own names and addresses):

```hcl
storage "raft" {
  path    = "/vault/data"
  node_id = "vault-0"
  retry_join {
    leader_api_addr = "https://vault-1.vault-internal:8200"
  }
  retry_join {
    leader_api_addr = "https://vault-2.vault-internal:8200"
  }
}

seal "awskms" {
  region     = "eu-west-1"
  kms_key_id = "alias/vault-unseal"
}

cluster_addr = "https://vault-0.vault-internal:8201"
api_addr     = "https://vault-0.vault-internal:8200"
```

Vault's AWS identity needs `kms:Encrypt`, `kms:Decrypt` and `kms:DescribeKey` on that key.

### Auth methods: proving who you are

An **auth method** checks a client's credentials against a system that already knows the client, and maps the result to policies:

- **Kubernetes.** A pod sends its service-account token. Vault passes it to the Kubernetes **TokenReview** API, which says whether it is valid and which service account and namespace it belongs to, and a Vault role binds those names to policies. When Vault itself runs in the cluster it can use its own service-account token for the TokenReview calls.
- **AWS.** A workload signs an `sts:GetCallerIdentity` request with its IAM credentials and gives it to Vault, which sends it on to AWS STS and checks the IAM principal that comes back against the Vault role's bound principals. EC2 instances can also log in with their signed identity document.
- **JWT/OIDC.** Vault validates JWTs from an OIDC issuer, such as a CI system or a Kubernetes cluster's own issuer, and signs people in through their company's identity provider in the browser.
- **AppRole.** A role ID and a secret ID, for machines with no platform identity. The secret ID still has to reach the machine safely, which is a job for response wrapping (below).
- Others cover people and older systems: user names and passwords, LDAP, TLS client certificates, and the Azure and Google Cloud identities.

```sh
vault auth enable kubernetes
vault write auth/kubernetes/config \
    kubernetes_host="https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT"
vault write auth/kubernetes/role/orders \
    bound_service_account_names=orders \
    bound_service_account_namespaces=shop \
    token_policies=orders-app \
    token_ttl=1h
```

### Tokens and policies

A successful login returns a **token**. Service tokens, the default kind, have started with `hvs.` since Vault 1.10; batch tokens, which are lighter and not stored, start with `hvb.`. A token carries its policies, a TTL and a maximum TTL (the system-wide maximum is 32 days unless configured otherwise), and it can be renewed up to that maximum. Tokens form a tree: revoking one revokes the tokens created from it, and every lease they were given.

A **policy** is a list of paths with capabilities: `create`, `read`, `update`, `patch`, `delete`, `list`, `sudo` and `deny`, plus a few special ones. Whatever no policy grants is denied, and `deny` beats every grant. The built-in `default` policy goes on every token unless a role leaves it out; among other things it lets a token look itself up, renew itself and renew its own leases.

```hcl
# vault policy write orders-app orders-app.hcl
path "database/creds/orders-rw" {
  capabilities = ["read"]
}
path "transit/encrypt/orders-key" {
  capabilities = ["update"]
}
```

The Orders service can encrypt card tokens but not decrypt them. Only the payments service, which charges the cards, gets a policy with `update` on `transit/decrypt/orders-key`.

### Secrets engines

Secrets engines are mounted at paths and do the actual work:

- **KV v2** stores static secrets, such as a partner's API key, with versions: 10 per key by default, soft delete and undelete, permanent destroy, and check-and-set writes that fail if someone else changed the secret first.
- **Database** creates a database user for each request from the role's SQL statements, extends it on renewal and drops it when the lease ends. Plugins cover PostgreSQL, MySQL and MariaDB, Microsoft SQL Server, Oracle, [MongoDB](../mongodb/) and MongoDB Atlas, [Redis](../redis/), Redshift and Snowflake, among others. **Static roles** rotate the password of an existing user on a schedule instead, for applications that can't cope with a changing user name.
- **PKI** is a certificate authority that issues X.509 certificates on request, also over ACME. Its documentation recommends short lifetimes, so that certificates expire instead of being revoked and revocation lists stay small.
- **Transit** performs cryptography on data it doesn't store: encrypt, decrypt and rewrap, sign and verify, HMACs, random bytes, and data keys for envelope encryption. Keys have versions, can't be exported unless they were created exportable, and default to the type `aes256-gcm96`.
- **Cloud credentials.** The AWS engine returns credentials per lease: an IAM user that it creates and deletes, or STS credentials from an assumed role, a federation token or a session token. Similar engines cover Azure and Google Cloud.

The database engine at Acme Shop, with a user-name template that gives short names such as `v-orders-rw-8f2kq7xm` (the default template also includes the token's display name and a timestamp):

```sh
vault secrets enable database
vault write database/config/orders-db \
    plugin_name=postgresql-database-plugin \
    connection_url="postgresql://{{username}}:{{password}}@orders-db.shop:5432/orders" \
    username="vault-admin" password="$INITIAL_PASSWORD" \
    password_authentication="scram-sha-256" \
    username_template="v-{{.RoleName}}-{{random 8 | lowercase}}" \
    allowed_roles="orders-rw"
vault write -f database/rotate-root/orders-db      # now only Vault knows vault-admin's password

vault write database/roles/orders-rw \
    db_name=orders-db \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    default_ttl=1h \
    max_ttl=24h
```

`password_authentication="scram-sha-256"` makes Vault hash the password before sending it, so it can't show up in PostgreSQL's logs; the default sends it in plain text. The transit side:

```sh
vault secrets enable transit
vault write -f transit/keys/orders-key                         # aes256-gcm96
vault write transit/encrypt/orders-key plaintext="$(printf '%s' "$CARD_TOKEN" | base64)"
# ciphertext  vault:v1:...   (the app stores this string)
vault write -f transit/keys/orders-key/rotate                  # new data is encrypted with v2
vault write transit/rewrap/orders-key ciphertext="vault:v1:..."  # v1 -> v2 without revealing the plaintext
vault write transit/keys/orders-key/config min_decryption_version=2   # once no v1 rows are left
```

Plaintext goes in as base64 and comes back as base64. The prefix of the ciphertext names the key version, so Vault knows which key decrypts it; `auto_rotate_period` rotates a key on a schedule (at most once an hour).

### Leases: TTL, renew, revoke

Every dynamic secret comes with a **lease**: an ID that starts with the path it came from (`database/creds/orders-rw/…`), a duration and a renewable flag. A client renews a lease with an increment counted from now, not from the end of the current lease, and the role's `max_ttl` caps how far renewals can go. When a lease expires, Vault's expiration manager revokes it, which for the database engine means running the role's revocation statements. `vault lease revoke` ends one lease at once, `vault lease revoke -prefix database/creds/orders-rw` ends every lease under that path after a suspected leak, and revoking a token revokes the leases created with it.

For PostgreSQL the creation statement usually ends the password's life inside the database too, with `VALID UNTIL '{{expiration}}'`. The plugin's default renewal moves that date (`ALTER ROLE … VALID UNTIL`), and its default revocation takes away the user's privileges and its `CONNECT` on the database before dropping the role.

### Response wrapping

Instead of returning a secret, Vault can store the response in the cubbyhole of a new single-use token with a short TTL (`-wrap-ttl` on the CLI, `X-Vault-Wrap-TTL` in the API) and return only that token. The intended recipient unwraps it once; if unwrapping fails because someone already did, the secret was intercepted and the incident is visible. It suits AppRole secret IDs and other first credentials.

### Audit devices

**Audit devices** (a file, syslog or a socket) receive the requests and responses of the Vault API, with a few documented exceptions. String values are replaced by an HMAC-SHA256 keyed per device, so the log shows that a `password` was returned without revealing it, and `sys/audit-hash` lets an investigator check whether a known value appears in it. If audit devices are enabled and none of them can write, Vault refuses to serve requests, so enable at least two and watch where they write.

### Getting secrets into Kubernetes

- **Vault Agent Injector.** A mutating admission webhook adds Vault Agent containers to pods annotated with `vault.hashicorp.com/agent-inject: "true"`: an init container that renders the secrets before the application starts, and a sidecar that keeps logging in, renewing and re-rendering them into the in-memory volume `/vault/secrets`.
- **Vault Secrets Store CSI provider.** A provider for the Secrets Store CSI driver: the secrets listed in a `SecretProviderClass` are read with the pod's service account and mounted as a volume while the container is created, so the pod doesn't start until they have been read.
- **Vault Secrets Operator (VSO).** An operator whose custom resources (`VaultStaticSecret`, `VaultDynamicSecret`, `VaultPKISecret`) sync secrets into ordinary Kubernetes Secrets, and can restart Deployments when a secret changes (`rolloutRestartTargets`).
- Outside Kubernetes, **Vault Agent** does the same on virtual machines: auto-auth, templates, caching and a process-supervisor mode. Applications that call the Vault API themselves can go through **Vault Proxy**; Vault Agent's own API proxy is deprecated.

The Orders Deployment's pod template (the `orders` service account and the `shop` namespace match the Kubernetes role above):

```yaml
spec:
  template:
    metadata:
      annotations:
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "orders"
        vault.hashicorp.com/agent-inject-secret-db: "database/creds/orders-rw"
        vault.hashicorp.com/agent-inject-template-db: |
          {{- with secret "database/creds/orders-rw" -}}
          postgresql://{{ .Data.username }}:{{ .Data.password }}@orders-db.shop:5432/orders
          {{- end }}
        vault.hashicorp.com/agent-inject-token: "true"   # /vault/secrets/token, for the app's transit calls
    spec:
      serviceAccountName: orders
```

The agent renews a renewable secret after two-thirds of its lease has passed, 40 minutes into a 1-hour lease, and the role's `max_ttl` of 24 hours is the furthest renewals can go, so a long-running pod moves to a new user at least once a day and the file changes.

### High availability, replication and editions

- **HA on integrated storage.** The Raft leader is the **active node** and the others are standbys that forward requests to it or redirect clients. A cluster of N voters needs a quorum of ceil((N+1)/2): three nodes survive one failure and five survive two, and HashiCorp recommends at least five for production, in an odd number. Followers start an election when they miss the leader's heartbeat, after 5 to 10 seconds with the default settings.
- **Enterprise.** Vault Enterprise (or HCP Vault Dedicated) adds **performance standbys** that answer reads locally, **performance replication** to other clusters, which keep their own tokens and leases, **disaster-recovery replication**, **namespaces** for tenants, **Sentinel** policies, and HSM auto-unseal over PKCS#11 with seal wrapping. The Community edition has integrated storage, HA with standbys, auto-unseal with the cloud KMS services, snapshots (`vault operator raft snapshot save`) and the engines described above.
- **Managed.** **HCP Vault Dedicated** is Vault Enterprise run by HashiCorp in a dedicated account on AWS or Azure, with the same API, CLI and UI.

### Licence and forks

Since August 2023, new Vault releases, 1.15 and later, are under the **Business Source License 1.1**. Production use is allowed except offering Vault to third parties, hosted or embedded, in competition with IBM's paid versions, and each release converts to MPL 2.0 four years after it was published. Earlier releases stayed under MPL 2.0, and **OpenBao** is the community fork that continues from that code under MPL 2.0, as a sandbox project of the Linux Foundation's OpenSSF. OpenBao 2.7.1 (October 2026) also has namespaces, an Enterprise feature in Vault, since 2.3.1 (June 2025). Its cloud auth methods and secrets engines (AWS, Azure, Google Cloud) come as separate plugins, and since 2.7.0 so do the KMS auto-unseal mechanisms.

## Where it fits

- **Solutions.** Secrets for microservices on Kubernetes, as at Acme Shop; database credentials per service and per pod; field-level encryption of card data and personal data with transit; an internal certificate authority for service-to-service TLS; CI/CD pipelines that trade an OIDC token for short-lived cloud credentials instead of storing keys; and one secrets system with one audit log across several clouds and data centres.
- **Patterns in this catalog.** Vault is the secrets half of an [external configuration store](../external-configuration-store/). Short-lived credentials bound to a verified workload identity are what [zero trust access](../zero-trust-access/) asks for between machines, and the PKI engine issues the certificates for [mutual TLS](../mutual-tls/). Dynamic users give each service its own login, which suits [database per service](../database-per-service/), and Vault Agent runs as a [sidecar](../sidecar/). Its path policies are a form of [policy-based authorization](../policy-based-authorization/), and its AWS engine hands out short-lived, narrowly scoped cloud credentials in the spirit of the [valet key](../valet-key/).
- **Usual neighbours.** [Kubernetes](../kubernetes/) and its API server; a cloud KMS or an HSM for auto-unseal; databases such as [PostgreSQL](../postgresql/); [AWS IAM](../aws-iam/) for the AWS auth method, the AWS engine and the KMS key's permissions; the company's identity provider, such as [Keycloak](../keycloak/), for people; Terraform for configuration; and a log pipeline or SIEM for the audit log, as in [centralized logging](../centralized-logging/).
- **Managed offerings.** HCP Vault Dedicated, on AWS or Azure. AWS doesn't run Vault as a service of its own: its services for these jobs are AWS Secrets Manager for secrets and rotation, AWS KMS for keys and encryption and AWS Certificate Manager for certificates, all with IAM for identity. OpenBao is self-managed.

## When to use it

Choose Vault, or OpenBao, when you need credentials created per workload and revoked automatically, encryption as a service with central key rotation, an internal certificate authority, or one secrets system for several clouds and on-premises with one audit trail. Choose your cloud's secrets service when the workloads live in that cloud and mostly need static secrets with rotation: there is nothing to run, unseal or upgrade. Plain Kubernetes Secrets only store values: nothing issues them per workload or expires them.

| | HashiCorp Vault | OpenBao | AWS Secrets Manager | Azure Key Vault | Kubernetes Secrets |
|---|---|---|---|---|---|
| What it is | Self-managed cluster, or HCP Vault Dedicated | Community fork of Vault, self-managed | Managed AWS service | Managed Azure service | A built-in API object |
| Licence | BSL 1.1 since 1.15; Enterprise is commercial | MPL 2.0 | Commercial service | Commercial service | Apache 2.0, part of Kubernetes |
| Dynamic credentials | Database users, cloud credentials, certificates, per lease | Same engines (cloud ones as plugins) | No; rotates a stored secret, managed or with a [Lambda](../aws-lambda/) function | No | No |
| Static secrets | KV v2 with versions | KV v2 with versions | Yes, with automatic rotation | Secrets, keys and certificates | Yes, base64 in the object |
| Encryption as a service | Transit | Transit | No; that is AWS KMS | Keys kept in the vault (HSM-protected in Premium) | No |
| Workload identity | Kubernetes, AWS, Azure, Google Cloud, JWT/OIDC, AppRole | Kubernetes, JWT/OIDC, AppRole, certificates; clouds as plugins | IAM | Microsoft Entra ID with Azure RBAC | Service accounts and RBAC |
| At rest | Barrier, AES-256-GCM | Barrier, AES-256-GCM | Encrypted with AWS KMS | Encrypted with HSM-held keys | Unencrypted in etcd unless encryption at rest is set up |
| Cost (October 2026) | Free under the BSL; Enterprise licence or HCP pricing | Free | $0.40 per secret per month and $0.05 per 10,000 API calls | Per 10,000 operations, plus per key per month for HSM-protected keys | Free |

Google Cloud's counterpart, Secret Manager, keeps versioned secrets and sends a `SECRET_ROTATE` message to Pub/Sub on a schedule, leaving the rotation itself to your code.

## Trade-offs

- **On the critical path.** A pod that needs a new secret can't start while Vault is sealed or unreachable; requests get HTTP 503. Running pods keep working until their leases end, so cache tokens and leases in the agent, keep TTLs longer than a plausible outage, and run three or five nodes.
- **Unsealing is a hard dependency.** Shamir shares need people at hand after every restart; auto-unseal moves that dependency to a KMS key whose loss destroys the data, backups included. Give the key a policy that lets very few people disable or delete it, alert on both, and keep the recovery keys offline.
- **One more stateful system.** Raft quorum, snapshots, upgrades, TLS certificates for the cluster, audit-log disks, plugin versions and telemetry are yours to run, as is the bootstrap: initializing, revoking the initial root token and writing policies as code.
- **Dynamic secrets move complexity into the application.** A user name that changes every day or so needs an application, or a connection pool, that re-reads its credentials and reconnects. Short TTLs shrink the window for a leaked password but multiply renewals and `CREATE ROLE`/`DROP ROLE` traffic on the database.
- **Lease and token growth.** Thousands of pods with short TTLs create many leases, and every lease is state that Vault stores, renews and must revoke later. Vault Enterprise can cap leases per path with lease count quotas; in the Community edition, size TTLs and roles with care.
- **Audit blocks availability.** If no enabled audit device can write, Vault stops serving requests. That is the right default for a secrets store, but it makes the audit destination part of the availability design.
- **Licence and vendor.** The BSL allows most production use but not competing hosted or embedded offerings, and HashiCorp now belongs to IBM. Teams that need an OSI open-source licence choose OpenBao, whose features have started to diverge from Vault's.

## Implementation notes

**Bootstrap once, then lock it away.** Run `vault operator init` once, encrypt the recovery-key shares to their holders' PGP keys, configure an auth method for operators, write the policies, and revoke the initial root token. Keep policies, roles and mounts in Terraform or another tool, so that every change is reviewed and repeatable.

**Rotate the database root credential.** `vault write -f database/rotate-root/orders-db` replaces the password Vault uses to manage users, so no person keeps a copy. Give `vault-admin` only what the creation and revocation statements need.

**Tell the application when the file changes.** The injector re-renders `/vault/secrets/db` when the agent fetches a new user. Either have the application watch the file and reconnect, or run a command after rendering with `vault.hashicorp.com/agent-inject-command-db`. Without that, the pod keeps using a user that Vault will drop when its lease ends.

**Bind roles tightly.** Bind each Kubernetes role to one service account in one namespace and give each workload its own policy. The role's `audience` setting adds a check on the token's audience claim, for pods that present a projected service-account token issued for Vault.

**Make leaks expensive.** Prefer dynamic secrets to KV entries where the target system supports them. Set `password_authentication="scram-sha-256"` for PostgreSQL. Use `vault lease revoke -prefix` in incident runbooks, and restart the affected pods after a revoke, so their agents read new users instead of holding on to the revoked ones.

**Transit in practice.** Store the ciphertext as text; it is longer than the plaintext. After a rotation, rewrap old rows in the background and then raise `min_decryption_version`. Use separate keys per purpose, and give decrypt rights only to the services that need plaintext.

**Operate the cluster.** Take regular `vault operator raft snapshot save` backups and practise restoring them. Enable two audit devices and ship the logs to your SIEM. Alert on the seal status, on leadership changes and on audit failures, and upgrade one node at a time.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [External Configuration Store](../external-configuration-store/) — Keep configuration out of the deployment package, in a central store read at runtime.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Mutual TLS (mTLS)](../mutual-tls/) — Client and server both present certificates, so every connection is authenticated both ways.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [PostgreSQL](../postgresql/) — A relational database: ACID transactions with MVCC, a write-ahead log for durability and replication, SQL and rich indexes.
- [Keycloak](../keycloak/) — An open-source identity provider: user sign-in, federation and single sign-on, issuing OpenID Connect and SAML tokens.
- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.

## References

- [HashiCorp Vault docs — Architecture](https://developer.hashicorp.com/vault/docs/internals/architecture)
- [HashiCorp Vault docs — Security model (barrier encryption)](https://developer.hashicorp.com/vault/docs/internals/security)
- [HashiCorp Vault docs — Seal/Unseal](https://developer.hashicorp.com/vault/docs/concepts/seal)
- [HashiCorp Vault docs — Key rotation](https://developer.hashicorp.com/vault/docs/internals/rotation)
- [HashiCorp Vault docs — vault operator init](https://developer.hashicorp.com/vault/docs/commands/operator/init)
- [HashiCorp Vault docs — AWS KMS seal configuration](https://developer.hashicorp.com/vault/docs/configuration/seal/awskms)
- [HashiCorp Vault docs — HSM PKCS11 seal configuration (Enterprise)](https://developer.hashicorp.com/vault/docs/configuration/seal/pkcs11)
- [HashiCorp Vault source — command/server.go (background unseal retries)](https://github.com/hashicorp/vault/blob/main/command/server.go)
- [HashiCorp Vault docs — Raft integrated storage](https://developer.hashicorp.com/vault/docs/internals/integrated-storage)
- [HashiCorp Vault docs — Integrated storage configuration](https://developer.hashicorp.com/vault/docs/configuration/storage/raft)
- [HashiCorp Vault docs — operator raft (snapshots)](https://developer.hashicorp.com/vault/docs/commands/operator/raft)
- [HashiCorp Vault docs — High availability](https://developer.hashicorp.com/vault/docs/concepts/ha)
- [HashiCorp Vault docs — Kubernetes auth method](https://developer.hashicorp.com/vault/docs/auth/kubernetes)
- [HashiCorp Vault API — Kubernetes auth method](https://developer.hashicorp.com/vault/api-docs/auth/kubernetes)
- [HashiCorp Vault docs — AWS auth method](https://developer.hashicorp.com/vault/docs/auth/aws)
- [HashiCorp Vault docs — JWT/OIDC auth method](https://developer.hashicorp.com/vault/docs/auth/jwt)
- [HashiCorp Vault docs — AppRole auth method](https://developer.hashicorp.com/vault/docs/auth/approle)
- [HashiCorp Vault docs — Tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens)
- [HashiCorp Vault docs — Policies](https://developer.hashicorp.com/vault/docs/concepts/policies)
- [HashiCorp Vault docs — Lease, renew, and revoke](https://developer.hashicorp.com/vault/docs/concepts/lease)
- [HashiCorp Vault docs — Database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases)
- [HashiCorp Vault docs — PostgreSQL database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases/postgresql)
- [HashiCorp Vault API — PostgreSQL database plugin](https://developer.hashicorp.com/vault/api-docs/secret/databases/postgresql)
- [HashiCorp Vault API — Database secrets engine](https://developer.hashicorp.com/vault/api-docs/secret/databases)
- [HashiCorp Vault docs — Username templating](https://developer.hashicorp.com/vault/docs/concepts/username-templating)
- [HashiCorp Vault source — PostgreSQL plugin (default renew and revocation statements)](https://github.com/hashicorp/vault/blob/main/plugins/database/postgresql/postgresql.go)
- [HashiCorp Vault docs — Transit secrets engine](https://developer.hashicorp.com/vault/docs/secrets/transit)
- [HashiCorp Vault API — Transit secrets engine](https://developer.hashicorp.com/vault/api-docs/secret/transit)
- [HashiCorp Vault docs — Key/Value v2](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2)
- [HashiCorp Vault API — KV v2](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)
- [HashiCorp Vault docs — PKI secrets engine](https://developer.hashicorp.com/vault/docs/secrets/pki)
- [HashiCorp Vault docs — AWS secrets engine](https://developer.hashicorp.com/vault/docs/secrets/aws)
- [HashiCorp Vault docs — Response wrapping](https://developer.hashicorp.com/vault/docs/concepts/response-wrapping)
- [HashiCorp Vault docs — Audit devices](https://developer.hashicorp.com/vault/docs/audit)
- [HashiCorp Vault docs — File audit device](https://developer.hashicorp.com/vault/docs/audit/file)
- [HashiCorp Vault API — HTTP API (status codes)](https://developer.hashicorp.com/vault/api-docs)
- [HashiCorp Vault docs — What is Vault Agent?](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent)
- [HashiCorp Vault docs — Vault Agent templates (renewals)](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent/template)
- [HashiCorp Vault docs — What is Vault Proxy?](https://developer.hashicorp.com/vault/docs/agent-and-proxy/proxy)
- [HashiCorp consul-template source — Vault secret renewal](https://github.com/hashicorp/consul-template/blob/main/dependency/vault_common.go)
- [HashiCorp Vault docs — Vault Agent Injector](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector)
- [HashiCorp Vault docs — Vault Agent Injector annotations](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector/annotations)
- [HashiCorp Vault docs — Vault Secrets Store CSI provider](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/csi)
- [HashiCorp Vault docs — Vault Secrets Operator](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/vso)
- [HashiCorp Vault docs — Vault Secrets Operator API reference](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/vso/api-reference)
- [HashiCorp Vault docs — Replication support in Vault](https://developer.hashicorp.com/vault/docs/enterprise/replication)
- [HashiCorp Vault docs — Performance standby nodes](https://developer.hashicorp.com/vault/docs/enterprise/performance-standby)
- [HashiCorp Vault docs — Namespaces](https://developer.hashicorp.com/vault/docs/enterprise/namespaces)
- [HashiCorp Vault docs — HCP Vault Dedicated overview](https://developer.hashicorp.com/vault/cloud)
- [HashiCorp Vault docs — Release notes 2.x](https://developer.hashicorp.com/vault/docs/updates/release-notes)
- [HashiCorp Vault docs — Deprecation notices](https://developer.hashicorp.com/vault/docs/updates/deprecation)
- [HashiCorp Vault releases on GitHub](https://github.com/hashicorp/vault/releases)
- [HashiCorp — HashiCorp adopts Business Source License (August 2023)](https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license)
- [HashiCorp Vault — LICENSE (Business Source License 1.1)](https://github.com/hashicorp/vault/blob/main/LICENSE)
- [IBM Newsroom — IBM Completes Acquisition of HashiCorp (February 2025)](https://newsroom.ibm.com/2025-02-27-ibm-completes-acquisition-of-hashicorp,-creates-comprehensive,-end-to-end-hybrid-cloud-platform)
- [OpenBao](https://openbao.org/)
- [OpenBao — CHANGELOG](https://github.com/openbao/openbao/blob/main/CHANGELOG.md)
- [OpenBao docs — Auth methods](https://openbao.org/docs/auth/)
- [OpenBao plugins (cloud auth, secrets and KMS seal plugins)](https://github.com/openbao/openbao-plugins)
- [AWS Secrets Manager User Guide — What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
- [AWS Secrets Manager User Guide — Rotate AWS Secrets Manager secrets](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)
- [AWS Secrets Manager User Guide — Secret encryption and decryption](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)
- [Microsoft Learn — Azure Key Vault overview](https://learn.microsoft.com/en-us/azure/key-vault/general/overview)
- [Azure Key Vault pricing](https://azure.microsoft.com/en-us/pricing/details/key-vault/)
- [Google Cloud — Secret Manager overview](https://docs.cloud.google.com/secret-manager/docs/overview)
- [Google Cloud — Create rotation schedules in Secret Manager](https://docs.cloud.google.com/secret-manager/docs/secret-rotation)
- [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes — Encrypting confidential data at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Kubernetes API — TokenReview](https://kubernetes.io/docs/reference/kubernetes-api/definitions/token-review-v1-authentication/)
- [PostgreSQL documentation — CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
