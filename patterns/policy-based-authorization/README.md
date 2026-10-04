<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Policy-Based Authorization

> Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).

<p align="center"><img src="diagram.svg" alt="Animated diagram: Policy-Based Authorization" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/policy-based-authorization.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Rules scattered in code** | Each service checks permissions with its own if-statements, in its own language, and they disagree: the Expenses API lets a manager approve up to **$5,000**, Reports assumes **$2,000**, and Payouts lets anyone in Finance or any manager release a payment of any size. Changing the limit means finding every copy, then editing, testing and redeploying each service, and nobody can answer *who may approve what* without reading three codebases. |
| **2 · Ask a decision point** | The Expenses API's **policy enforcement point** (PEP) asks one question: may subject `ana` perform `approve` on resource `e-42`, in this context? The **policy decision point** (PDP) evaluates policy v12 against Ana's attributes (manager, Sales) and those of e-42 ($1,800, Sales), answers **allow** with the rule that matched, the PEP enforces the answer, and the decision is logged. The policy itself lives in Git, where it is reviewed and tested like code before a new version is shipped to the PDP. |
| **3 · RBAC, ABAC or ReBAC** | **RBAC** grants by role: Ana is a manager, so she may approve, but so would Cara from Marketing, at any amount. **ABAC** also weighs attributes of the user and the expense (same department, up to $5,000), so Ana may approve e-42 but not the $7,000 e-43, and Cara may not approve e-42. **ReBAC** follows stored relationships, as Google's Zanzibar does: Ana manages Bo, Bo owns e-42, so Ana may approve it. |
| **4 · Fast, safe, auditable** | The engine runs next to the service, as a sidecar or an embedded library, and a control plane ships it versioned bundles of policy and data, so a check typically takes well under a millisecond and needs no network call. Ana's list of expenses to approve comes from one filter query (`dept = Sales and amount ≤ 5000`), not from one check per row. When the PDP cannot be reached, the PEP **denies** (fails closed), and every decision is logged with its inputs for audit. |
<!-- END GENERATED: header -->

## The problem

Authentication and authorization answer different questions. **Authentication** establishes who is calling: the user signs in at an identity provider and the application receives proof of it in a token or an assertion ([OpenID Connect](../openid-connect/), [SAML 2.0 Single Sign-On](../saml-sso/)). **Authorization** decides what that caller may do, and sign-in protocols leave that to the application. So every service writes its own checks, usually as `if` statements in its handlers, and the result looks like step 1:

- **The copies drift.** The Expenses API lets a manager approve up to $5,000, Reports was written when the limit was $2,000, and Payouts never had a limit at all. Each copy was right when someone wrote it. Broken access control, which includes missing and inconsistent checks, heads the OWASP Top 10:2025.
- **A rule change becomes a release train.** Raising the limit means finding every copy, in three codebases and three languages, then editing, testing and redeploying each service, and hoping none was missed.
- **Nobody can say who may do what.** An auditor who asks who can approve a $4,000 Sales expense gets an answer only after someone has read all three codebases, and nothing records which decisions were made or why.

Roles and scopes in tokens don't close the gap. A token can say that the caller is a manager, or that the client may call `expenses:approve`, and [JWT Validation](../jwt-validation/) checks such **coarse-grained** claims on every request. Whether Ana may approve *this* expense depends on the expense: who submitted it, which department it belongs to, how large it is. That **fine-grained**, per-object decision needs data the token doesn't carry, and it is the decision this pattern takes out of the code.

## How it works

### Four parts

The job is split into four parts. The names come from XACML 3.0, an OASIS Standard from January 2013, and NIST SP 800-162, the guide to attribute-based access control (2014, last updated 2019), describes the same four:

| Part | What it does | In the diagram |
|---|---|---|
| **PEP**, policy enforcement point | Sits in the request path: describes the request to the PDP, waits for the answer and enforces it. | Middleware, or an SDK call, in front of every operation of the Expenses API |
| **PDP**, policy decision point | Evaluates the policies that apply to the request and returns a decision. | The policy engine |
| **PAP**, policy administration point | Where policies are written, managed and tested, and from where they are published. | The policy repository in Git, with review and tests |
| **PIP**, policy information point | Supplies the attribute values the PDP needs. | The directory, the expense data and the relationship store |

XACML adds a *context handler* that translates between the application's request format and the PDP's and collects attributes from the PIPs. NIST treats it as optional and notes that it can fetch or cache attributes ahead of a request. NIST also stresses that these are logical functions: the PEP and the PDP may be one central service or spread across the estate, which is the choice step 4 makes.

### One question, one answer

The PEP asks a question in four parts:

- **Subject:** who is asking (`ana`), with attributes such as role and department.
- **Action:** what they want to do (`approve`).
- **Resource:** what they want to do it to (`e-42`), with attributes such as owner, department and amount.
- **Context:** anything else the policy may weigh: time, network, device, how the user signed in.

The PDP answers *allow* or *deny*, often naming the rule that decided. The service never sees the rule, only the answer, so every service that asks the same question gets the same answer. The OpenID Foundation's **AuthZEN Authorization API 1.0**, a Final Specification since January 2026, standardises this exchange as JSON over HTTPS:

```http
POST /access/v1/evaluation
Content-Type: application/json

{
  "subject":  { "type": "user", "id": "ana" },
  "action":   { "name": "approve" },
  "resource": { "type": "expense", "id": "e-42" },
  "context":  { "time": "2026-10-04T09:41:07Z" }
}
```

```json
{ "decision": true }
```

A response can add a `context` object with reasons or obligations. The specification also defines a batch endpoint (`/access/v1/evaluations`), search endpoints that return the subjects, resources or actions a request would be allowed for, and discovery metadata at `/.well-known/authzen-configuration`, so a PEP written against it can work with any PDP that implements it.

### Policy as code

The policy becomes a file in a repository instead of `if` statements spread over services. Here is the whole expense policy in Rego, the language of Open Policy Agent (OPA):

```rego
package expenses

default allow := false

# Everyone may view their own expenses.
allow if {
	input.action == "view"
	input.resource.owner == input.subject.id
}

# A manager may approve expenses from their own department, up to $5,000.
allow if {
	input.action == "approve"
	input.subject.role == "manager"
	input.subject.department == input.resource.department
	input.resource.amount <= 5000
}

# Finance may approve any amount.
allow if {
	input.action == "approve"
	input.subject.department == "Finance"
}
```

Changing the limit is now a one-line pull request. Reviewers see exactly what changes, the policy's unit tests (`opa test`) run in CI, a new version (v12 in the diagram) is built and shipped to the PDPs, and every decision records the version that made it.

### Three ways to write the rule

**Role-based access control (RBAC)** attaches permissions to roles and gives roles to users. David Ferraiolo and Rick Kuhn formalised it at NIST in 1992; the unified NIST model, written with Ravi Sandhu in 2000, became the standard ANSI/INCITS 359-2004, revised as INCITS 359-2012. Its reference model has four components: core RBAC, role hierarchies, and static and dynamic separation of duty. RBAC is easy to administer and to review (list who holds the role), and it is the right starting point for most applications. Its limit shows in step 3: a role knows nothing about the expense, so "manager" would let Cara approve Sales expenses, and anyone holding it approve any amount. Folding department and limit into role names (`sales-manager-5k`) leads to what is often called *role explosion*, one of the reasons NIST SP 800-162 gives for ABAC.

**Attribute-based access control (ABAC)**, as NIST SP 800-162 defines it, decides from attributes of the subject, attributes of the object, conditions of the environment, and policies written in terms of them. One rule ("a manager may approve expenses from their own department, up to $5,000") covers every department and every amount: Ana may approve e-42 but not the $7,000 e-43, and Cara may not approve e-42. Rule 3 needs no role at all: Dev, in Finance, may approve e-43. The price is that a decision is only as good as its attributes, which must be trustworthy and current, and that "who may approve e-42?" is no longer a lookup: the policy has to be evaluated against everyone's attributes.

**Relationship-based access control (ReBAC)** derives permissions from relationships between objects: Ana manages Bo, Bo owns e-42, so Ana may approve e-42. Relationships are stored as tuples, and a check walks the graph they form. Google described its system for this in the **Zanzibar** paper (Pang et al., USENIX ATC 2019): one authorization service behind Calendar, Cloud, Drive, Maps, Photos, YouTube and many other products, which held more than two trillion relation tuples, served millions of checks per second with a 95th-percentile latency under 10 ms, and stayed above 99.999% availability over three years. Its tuples read `object#relation@user`, so the diagram's two facts are `expense:e-42#owner@user:bo` and `user:bo#manager@user:ana` (abbreviated in the diagram). ReBAC suits sharing and hierarchies, such as folders, projects, teams and organisations, where access follows structure. In OpenFGA's modelling language the approval rule is one line, `approver: manager from owner`:

```
model
  schema 1.1

type user
  relations
    define manager: [user]

type expense
  relations
    define owner: [user]
    define approver: manager from owner
    define viewer: owner or approver
```

Consistency is the hard part of a relationship store, and the Zanzibar paper calls the failure the **"new enemy" problem**. Suppose Alice removes Bob from a folder and then has new documents moved into it. A check that sees the second change but not the first lets Bob read documents he was never meant to see. Zanzibar keeps its tuples in Spanner, whose TrueTime clock gives every write a timestamp that respects causal order, and evaluates each check at a single snapshot. When an application saves new content it asks for a **zookie**, an opaque token that encodes a timestamp, stores it with the content and passes it on later checks, so they are evaluated against data at least that fresh. SpiceDB calls the same token a ZedToken and lets each request choose between speed (`minimize_latency`) and freshness (`at_least_as_fresh`, `at_exact_snapshot`, `fully_consistent`).

The models combine. A role is just one more attribute to an ABAC policy, relationship models express roles as relationships (member of a group), OpenFGA adds *conditions* and SpiceDB *caveats* (CEL expressions over attributes) to relationship checks, and Cedar is designed to cover all three styles.

### Engines and languages

As of October 2026:

- **Open Policy Agent (OPA)** is a general-purpose engine with its own language, Rego, used well beyond applications, for example for Kubernetes admission control. It runs as a daemon or sidecar behind a REST API, embeds in Go programs as a library, or compiles policies to WebAssembly. Since OPA 1.0 (December 2024), Rego requires the `if` keyword before a rule body. OPA has been a graduated CNCF project since January 2021. In August 2025 its creators and several engineers from Styra, the company that had backed it, joined Apple; the project's governance and licence did not change, and Styra's tools, among them the OPA Control Plane and the Regal linter, moved into the OPA project.
- **Cedar** is a policy language and engine created at AWS, written in Rust, with key properties of its design proven in the Lean proof assistant. A policy either `permit`s or `forbid`s; nothing is allowed unless a `permit` matches, any matching `forbid` wins, and the answer lists the policies that decided it. A schema lets policies be validated before they are deployed. Cedar joined the CNCF Sandbox in October 2025. **Amazon Verified Permissions** is a managed Cedar PDP: `IsAuthorized` evaluates a request, and `IsAuthorizedWithToken` takes the principal straight from an ID or access token issued by the policy store's identity source, an Amazon Cognito user pool or another OpenID Connect provider; both have batch versions. The approval rule in Cedar:

  ```cedar
  permit (
    principal,
    action == Action::"approve",
    resource
  )
  when
  {
    principal.role == "manager" &&
    principal.department == resource.department &&
    resource.amount <= 5000
  };
  ```

- **OpenFGA** is a relationship store inspired by Zanzibar and an incubating CNCF project since October 2025. It answers `Check`, `BatchCheck`, `ListObjects` and `ListUsers`.
- **SpiceDB**, open source (Apache 2.0) from AuthZed, is a database modelled closely on Zanzibar, with `CheckPermission`, `LookupResources` and `LookupSubjects`.
- **Casbin** is a library rather than a service. A small configuration file built on its PERM metamodel (policy, effect, request, matchers) selects ACL, RBAC, ABAC or a mix, and the policies live in a file or a database. The Go library entered the Apache Incubator in February 2026; ports exist for Java, Node.js, PHP, Python, .NET, C++ and Rust.

## When to use it

- Several services, teams or languages enforce the same business rules, and they have to agree.
- Decisions depend on the object (owner, department, amount, who it was shared with), not only on a role in a token.
- Rules change more often than the services that enforce them, or they belong to someone other than the service teams: security, compliance, a product owner.
- Auditors or customers ask who can do what, and why a particular request was allowed.
- Users share things with each other (documents, projects, workspaces). That is a relationship model, and a ReBAC store does the graph walking for you.

**When not to.** One service with a handful of roles doesn't need a policy engine. Keep the checks in code, but in one place: a single authorization module that every handler calls, that denies by default and that has its own tests. That module is a PEP and a PDP in miniature, and it can later be pointed at a real PDP without touching the handlers.

## Trade-offs

- **A dependency on every request.** If the PEP gets no answer, the operation fails, by design. The PDP must be as available as the most critical service that calls it. Running it next to each service (step 4) takes the network out of the path, but not the dependency.
- **Latency.** A central PDP adds a network round trip to every check, and a page that checks many things pays it many times. A local engine is much faster: OPA's documentation treats about a millisecond as the budget for API authorization, and the benchmarks in the Cedar paper measured median evaluations of 4 to 11 µs for Cedar and of roughly 76 to 750 µs for Rego and OpenFGA, with tails beyond a millisecond as the data grew. Measure with your own policies and data.
- **Freshness.** A local PDP decides with the copy of policy and data it holds. When Ana stops managing Bo, or an expense moves to another department, the decision changes only when the new data arrives, a trade-off between cached attributes and security that NIST SP 800-162 spells out. Attributes taken from a token stay as they were until the token expires.
- **The same facts in two places.** Relationship stores and data bundles copy what the application already knows (who owns e-42), and the copies must be kept in step, typically by writing tuples in the same workflow as the application data or by streaming its changes.
- **Another language to learn.** Rego, Cedar and relationship models are small, but they are code: they need tests, review, and people who can read them during an incident.
- **"Who can do what?" is still work.** Under ABAC the question means evaluating the policy against many subjects; relationship stores answer it directly (`ListUsers`, `LookupSubjects`), one reason products combine the models.

## Implementation notes

- **Where the PDP runs.**
  - *Central service:* one deployment to update and observe, but a network hop for every check and one shared dependency for every caller. Managed PDPs such as Amazon Verified Permissions work this way.
  - *Sidecar or host daemon:* the engine runs beside each service and is called over localhost (see [Sidecar](../sidecar/)), while a control plane distributes policy and data. OPA polls a bundle server (long polling is supported), can verify signed bundles, can keep the last bundle on disk so it starts even when the server is down, and its health endpoint with the `bundles` option reports healthy only after every bundle has loaded, which makes a good readiness probe. The OPA Control Plane builds bundles from Git repositories and data sources and publishes them to object storage.
  - *Embedded library:* Cedar in process, or OPA as a Go library or WebAssembly module. There is no hop at all, but upgrades to the engine ship with the application.
- **Where attributes come from.** Subject attributes can travel in the token: roles, groups or department as claims in an [OpenID Connect](../openid-connect/) ID token or access token, or in a SAML assertion from the identity provider (see [Federated Identity](../federated-identity/)). Claims cost nothing to read but keep the values they had when the token was issued; Amazon Verified Permissions, for one, notes that a token stays usable until it expires even if it has been revoked. Resource attributes usually come from the service, which has just loaded e-42 and can pass its owner, department and amount in the request. Anything else the PDP looks up at decision time from a PIP, which is fresher but adds latency and one more dependency.
- **Lists and filters.** Don't load a thousand rows and check each one; ask for a filter or a list:
  - *Partial evaluation.* OPA evaluates the policy with the subject known and the resource unknown and returns the conditions that remain, for Ana `department = "Sales"` and `amount <= 5000`. Its Compile API can return them as a SQL `WHERE` clause, or as UCAST for an ORM, so the database does the filtering.
  - *List queries.* OpenFGA's `ListObjects`, SpiceDB's `LookupResources` and AuthZEN's resource search return the objects a subject may act on. OpenFGA caps `ListObjects` at 1,000 results and 3 seconds by default, and for large collections recommends searching first and checking each page with `BatchCheck`.
- **Policy as code.** Keep policies in Git next to their tests (`opa test`, Cedar's validator with a schema, `fga model test`), review every change, build versioned and signed bundles, roll them out in stages, and record the version in every decision so that an answer can be explained later. [GitOps](../gitops/), with the policy repository as the source of truth that deployments reconcile to, fits naturally.
- **Decision logs.** Log every decision with an ID, the inputs, the result, the rule that matched and the policy version, and ship the logs to [Centralized Logging](../centralized-logging/). OPA's decision logs record a decision ID, the input, the result and the bundle revision, can mask or drop sensitive inputs before they leave the host, and are uploaded in compressed batches. With the inputs recorded, "why was this allowed?" has an answer, and recorded requests make good test cases for the next policy change.
- **Fail closed.** Treat a timeout, an error or an unknown answer as *deny*. Envoy's external authorization filter does so by default (`failure_mode_allow` is `false`), and the OWASP Authorization Cheat Sheet recommends denying by default.
- **Cache with care.** If you cache decisions, the key must include everything that influenced them, including the policy version; entries should expire quickly, and a new bundle should flush them. Caching the inputs (attributes, tuples) is usually safer than caching the answers.
- **Coarse at the edge, fine in the service.** Let the [API Gateway](../api-gateway/) reject requests without a valid token or without the right scope: it is cheap and stops most bad traffic before it reaches a service. The decision about one expense belongs in the service's PEP, which has the object at hand. A proxy in front of the service (Envoy calling OPA, for example) sees the method, the path and the token, but not who owns e-42.
- **Zero trust, one level down.** [Zero Trust Access](../zero-trust-access/) uses the same PDP and PEP split to decide whether a user on a device may reach an application at all. Policy-based authorization applies the idea inside the application, to individual objects and actions, and the two usually share the identity provider and the decision logs.
- **Test the denials.** The tests that matter most prove that Cara cannot approve e-42 and that Ana cannot approve e-43. Real policies also add separation of duty, such as never approving your own expense; with the policy in one place, that is one more condition instead of a change to three services.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [API Gateway](../api-gateway/) — One entry point that authenticates, rate-limits and routes calls to backend services.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [SAML 2.0 Single Sign-On](../saml-sso/) — Enterprise SSO: the identity provider posts a signed assertion to the app through the browser.
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [Centralized Logging](../centralized-logging/) — Ship structured logs from every service to one searchable store, correlated by request ID.

## References

- [NIST SP 800-162 — Guide to Attribute Based Access Control (ABAC) Definition and Considerations](https://csrc.nist.gov/pubs/sp/800/162/upd2/final)
- [OASIS — eXtensible Access Control Markup Language (XACML) Version 3.0](https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html)
- [NIST — Role Based Access Control (the NIST model and ANSI/INCITS 359)](https://csrc.nist.gov/projects/role-based-access-control)
- [Pang et al. — Zanzibar: Google's Consistent, Global Authorization System (USENIX ATC 2019)](https://www.usenix.org/conference/atc19/presentation/pang)
- [OpenID Foundation — Authorization API 1.0 (AuthZEN, Final Specification)](https://openid.net/specs/authorization-api-1_0.html)
- [OWASP — Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [Open Policy Agent — Bundles](https://www.openpolicyagent.org/docs/management-bundles)
- [Open Policy Agent — Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)
- [Open Policy Agent — Data Filtering with OPA](https://www.openpolicyagent.org/docs/filtering)
- [Open Policy Agent — Policy Performance](https://www.openpolicyagent.org/docs/policy-performance)
- [Open Policy Agent — Note from Teemu, Tim, and Torin to the OPA community (August 2025)](https://www.openpolicyagent.org/blog/note-from-teemu-tim-and-torin-to-the-open-policy-agent-community-2dbbfe494371)
- [Cedar — Policy Language Reference Guide](https://docs.cedarpolicy.com/)
- [Cutler et al. — Cedar: A New Language for Expressive, Fast, Safe, and Analyzable Authorization (OOPSLA 2024)](https://arxiv.org/abs/2403.04651)
- [AWS — What is Amazon Verified Permissions?](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/what-is-avp.html)
- [OpenFGA — Relationship Queries: Check, Read, Expand, ListObjects and ListUsers](https://openfga.dev/docs/interacting/relationship-queries)
- [AuthZed — SpiceDB consistency and ZedTokens](https://authzed.com/docs/spicedb/concepts/consistency)
- [Apache Casbin (incubating) — source and documentation](https://github.com/apache/casbin)
- [Envoy — External Authorization filter API (failure_mode_allow)](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_authz/v3/ext_authz.proto)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
