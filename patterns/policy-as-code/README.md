
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Policy as Code

> Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Policy as Code" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/policy-as-code.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A wiki and a weekly gate** | Before: Acme's platform rules are a 20-item wiki page, and every infrastructure change waits for the weekly change advisory board, which reads each request against the page by eye. Change request CR-2207 waits from Monday to Thursday and is approved, while CR-2211 is rejected for missing tags that CR-2207 lacks too, and nothing checks deploys at all. A security scan finds the public bucket `returns-exports` two months after it was created, and to engineers security feels like a gate. |
| **2 · Rules as code, in CI** | The rules become code in the Git repository `acme/policies`: Rego files with unit tests that `opa test` runs (18 of 18 pass), changed through reviewed pull requests like any other code. Pull request #512 adds the bucket `returns-label-exports` with public access switched on; the CI check runs Conftest against the Terraform plan and fails in 40 seconds with a message that names the rule, the resource and the fix. The developer pushes the fix 2 minutes later, the check passes, and the bucket is created private. |
| **3 · At deploy and in audit** | The same repository feeds the cluster's admission controller (OPA Gatekeeper here), which rejects a debug pod from Docker Hub and, later, a root pod from a vendor chart, and a continuous audit of what already runs (Gatekeeper's audit in the cluster, AWS Config in the account). The new rule `no-root` starts in **warn** mode: the audit finds 12 of 38 running pods that break it and sends a ticket to each of the 5 owning teams. Three weeks later 11 are fixed, `legacy-invoicing` gets an exception in `exceptions.yaml` with an owner and an expiry date, and the rule switches to **deny**. |
| **4 · Pitfalls and limits** | Sixty rules in the first week turn every build red and push teams to side doors: start with a few, in warn mode. Rules without tests break deploys by surprise, a vague message sends people back to a queue, exceptions granted in chat never expire, and a rule copied into two engines drifts (here the CI copy skips init containers). Passing checks don't replace a design review: policy as code gives teams guardrails, not gates. |
<!-- END GENERATED: header -->
## The problem

Acme Shop's platform team cares about four rules more than most: container images come only from Acme's registry and are pinned by digest, containers don't run as root, every cloud resource carries `team` and `cost-centre` tags, and S3 buckets never allow public access. They were among the 20 items on a wiki page, and the weekly change advisory board (CAB) enforced them: every infrastructure change waited for Thursday's meeting, where reviewers read the request and compared it with the list by eye.

That arrangement failed in three ways at once. It was **slow**: a request filed on Monday was approved on Thursday, three days for one bucket. It was **inconsistent**: the same meeting rejected CR-2211 for missing tags and approved CR-2207, which had no tags either. And it **still missed things**: CR-2207's bucket, `returns-exports`, allowed public access, and nobody noticed until another team's security scan found it two months later. The board also saw only what was brought to it; `kubectl`, Helm and clicks in the AWS console never reached the meeting. Engineers learned that security was a gate to get through, not something that helped them. (Acme's numbers on this page are the example's own, not research findings.)

DORA's research points the same way. Its guide to streamlining change approval reports that in the 2019 State of DevOps research, approval by an external body such as a change advisory board went with lower software delivery performance, and that the research found no evidence that such approval lowered the change failure rate. DORA recommends peer review inside the development workflow, together with automation that detects bad changes early.

## How it works

**Policy as code** writes rules in a language a machine evaluates, keeps them in version control, tests and reviews them like any other code, and runs them automatically wherever a change can enter. A rule stops being a sentence that each reviewer interprets and becomes a function: given a Terraform plan or a Kubernetes object, it says which rule is broken, where, and how to fix it.

### Decision and enforcement points

Two roles make it work, the same two that [policy-based authorization](../policy-based-authorization/) names. A **policy decision point** evaluates the rules against structured input; the Open Policy Agent (OPA) documentation describes OPA as a general-purpose engine that separates policy decisions from their enforcement. **Policy enforcement points** ask for a decision and act on it: fail a build, reject a request, file a finding. Acme uses three, all fed from one repository, `acme/policies`:

1. **CI, before merge.** Conftest evaluates every pull request's Terraform plan (`terraform show -json` turns it into JSON) and its Kubernetes manifests. The answer arrives in the pull request within a minute, while the author still has the change in mind.
2. **Admission, when something is created.** The Kubernetes API server asks an admission controller before it stores an object, so the rules also cover `kubectl`, Helm installs and operators that never went through CI. Acme runs OPA Gatekeeper, whose denial names the constraint that failed: `[no-root] container "render" runs as UID 0`.
3. **Audit, on what already runs.** Gatekeeper's audit evaluates the objects already in the cluster (every 60 seconds by default) and lists violations on each constraint, and AWS Config rules do the same for resources in the AWS account. Audit finds what existed before a rule was written and anything that slipped past the other two.

Each point covers a gap in the others: CI sees only changes that go through CI, admission sees only requests to its own cluster, and audit sees a problem only once it exists. AWS Control Tower sorts its controls the same way: **proactive** controls check resources before they are provisioned (CloudFormation hooks), **preventive** ones stop disallowed actions (service control policies, resource control policies and declarative policies), and **detective** ones find non-compliant resources afterwards (AWS Config rules).

Most engines can also **observe before they block**, which is what lets a new rule start as a warning: Conftest has `warn` rules next to `deny`; a Gatekeeper constraint takes `enforcementAction: dryrun`, `warn` or `deny`; Kubernetes ValidatingAdmissionPolicy takes the validation actions `Deny`, `Warn` and `Audit`, and Kyverno's ValidatingPolicy uses the same field (`Audit` or `Deny`, for example); Pod Security Admission sets `enforce`, `audit` and `warn` per namespace; and Sentinel has advisory, soft-mandatory and hard-mandatory levels.

**How this differs from policy-based authorization.** That page is about authorization inside an application at runtime: may Ana approve expense e-42, decided on every request. This page is about guardrails on infrastructure and delivery: is this plan, this manifest or this running resource allowed? The engines overlap (OPA serves both), but the input, the timing and the owners differ. Application teams own authorization rules and evaluate them per request; platform and security teams own guardrails and evaluate them on changes and on what is running.

### A rule and its tests

Acme's S3 rule in Rego, as Conftest runs it on the plan JSON. OPA 1.0 (December 2024) made this syntax, with `if` and `contains`, the default:

```rego
package main

settings := ["block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"]

deny contains msg if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket_public_access_block"
	some s in settings
	rc.change.after[s] == false
	msg := sprintf("s3-no-public-access: %s allows public access. Keep all four settings true; share files with presigned URLs.", [rc.address])
}
```

Its unit tests, which both `opa test` and `conftest verify` run:

```rego
package main_test

import data.main

plan_with(v) := {"resource_changes": [{
	"address": "aws_s3_bucket_public_access_block.labels",
	"type": "aws_s3_bucket_public_access_block",
	"change": {"after": {
		"block_public_acls": true,
		"block_public_policy": v,
		"ignore_public_acls": true,
		"restrict_public_buckets": v,
	}},
}]}

test_public_bucket_is_denied if {
	count(main.deny) == 1 with input as plan_with(false)
}

test_private_bucket_passes if {
	count(main.deny) == 0 with input as plan_with(true)
}
```

On the plan of pull request #512, Conftest prints `FAIL - plan.json - main - s3-no-public-access: aws_s3_bucket_public_access_block.labels allows public access. …` and exits with a non-zero status, which fails the check. After the fix it reports `3 tests, 3 passed, 0 warnings, 0 failures, 0 exceptions`.

### The engines (October 2026)

| Engine | Where it runs | Rules written in | Worth knowing |
|---|---|---|---|
| Open Policy Agent (OPA) | Anywhere: the `opa` CLI, a server with a REST API, a Go library, or compiled to WebAssembly | Rego | CNCF graduated (January 2021). `opa test` runs unit tests. In August 2025 OPA's creators and several Styra colleagues joined Apple; the project remains CNCF graduated, with unchanged governance and licence. |
| Conftest | CI and the command line, on JSON, YAML, HCL, Dockerfiles and other formats | Rego | An OPA project. `deny`, `warn` and `exception` rules; `conftest verify` runs tests; output formats for GitHub Actions, JUnit and SARIF. |
| OPA Gatekeeper | A Kubernetes admission webhook, an audit, and the `gator` CLI for pipelines | Rego, or CEL | An OPA project. Templates plus constraints, each `deny`, `dryrun` or `warn`. Can generate ValidatingAdmissionPolicies (beta since v3.20). The webhook fails open by default and leaves the rest to the audit. |
| Kyverno | Kubernetes admission, background scans, and a CLI for pipelines | YAML with CEL | CNCF graduated (March 2026). Its CEL-based policy types (ValidatingPolicy and others) replace ClusterPolicy, deprecated since 1.19. Policy reports and policy exceptions are built in. |
| ValidatingAdmissionPolicy | Inside the Kubernetes API server, with no webhook | CEL | Stable since Kubernetes 1.30. `Deny`, `Warn` and `Audit` actions. It judges requests as they arrive and has no background scan of existing objects. |
| Pod Security Admission | Inside the Kubernetes API server | Three fixed levels | Stable since Kubernetes 1.25. The `restricted` level already requires containers to run as non-root: use it before writing your own rule. |
| HashiCorp Sentinel | Inside HashiCorp products: HCP Terraform and Terraform Enterprise runs, [Vault](../vault/), Consul and Nomad | Sentinel | Advisory, soft-mandatory and hard-mandatory levels; `sentinel test`. HCP Terraform also runs OPA policies, and offers a native HCL-based policy framework in beta. |
| Cedar | Inside applications through its SDKs, and in Amazon Verified Permissions | Cedar | Built for application authorization (principal, action, resource, context); a CNCF sandbox project since October 2025. It belongs to [policy-based authorization](../policy-based-authorization/) more than to infrastructure guardrails. |
| AWS Organizations SCPs | Every AWS API call in member accounts | IAM policy JSON | Set the maximum permissions of IAM users and roles, never grant any, and don't apply to the management account. Preventive. |
| AWS Config rules | Resources in an AWS account, on every configuration change or periodically | Managed rules, Guard or [Lambda](../aws-lambda/) | Detective, with a proactive evaluation mode. Managed rules such as `required-tags` and `s3-bucket-level-public-access-prohibited` cover common checks. |

### The lifecycle of a rule

1. **Write** it from a real incident or requirement, with a message that names the rule, the resource and the fix, and links to the rule's page.
2. **Test** it with at least one input that must pass and one that must fail (`opa test`, `conftest verify`, `gator verify`, `kyverno test` or `sentinel test`), run by the policy repository's own CI.
3. **Review** it like code: a pull request to the policy repository, approved by its owners (at Acme the platform and security teams) and announced to the teams it will affect.
4. **Roll it out in audit or warn mode.** Let the audit list what it would block today, and send each finding to the team that owns it. Acme's `no-root` found 12 of 38 pods, in 5 teams' namespaces.
5. **Enforce** it once the count is near zero, with dated exceptions for the rest. Acme switched `no-root` to deny after three weeks.
6. **Measure** it: violations per rule and per team, how long a failed check takes to fix, how many exceptions are open and how old they are, and which rules people keep working around.
7. **Retire** it when something built in makes it unnecessary (Pod Security Admission's `restricted` level, enforced in every namespace, covers non-root) or when it no longer catches anything worth catching. A default is not enough on its own: new S3 buckets block public access by default, yet PR #512 switched that off in two lines.

### Exceptions

A rule that can never be broken gets broken quietly, with a label added by hand or a namespace nobody checks. So make exceptions part of the policy: an entry in a file in the policy repository, added by pull request, with the workload, the rule, an owner, a reason and an expiry date. The engines read it: Conftest has `exception` rules, a Gatekeeper constraint can leave namespaces out with `excludedNamespaces` or take a list as a parameter, and Kyverno has a PolicyException resource. A check that ignores expired entries makes the date real:

```yaml
# exceptions.yaml in acme/policies
exceptions:
  - workload: legacy-invoicing
    rule: no-root
    owner: payments team
    reason: vendor binary needs UID 0 until the rebuild
    expires: "2026-12-31T23:59:59Z"
```

```rego
package main

# An exception counts only until its expiry date.
excepted(rule, workload) if {
	some e in data.exceptions
	e.rule == rule
	e.workload == workload
	time.now_ns() < time.parse_rfc3339_ns(e.expires)
}
```

### Compliance with continuous evidence

Rules as code change what a compliance audit looks at. Instead of meeting minutes and screenshots, Acme can show each rule and its tests, the reviewed history of every change to it in Git, the check result on every pull request, the admission denials, and the audit findings over time (Gatekeeper's constraint status and AWS Config's evaluation results). That evidence accumulates as a side effect of shipping. Segregation of duties comes from peer review of both the code and the rules, which DORA's guide notes can meet that requirement. Policy as code doesn't make a system compliant by itself, though: people still decide which rules a framework needs, and an auditor still judges whether they are enough.

## Putting it into practice

1. **Start from the rules you have.** Turn the wiki into a list, drop or rewrite anything nobody can state precisely, and choose the three to five rules that matter most. Acme started with public buckets, the image registry and tags, and added `no-root` later.
2. **Create a policy repository** with named owners, a short page per rule, and CI that runs every rule's tests on every change. Tag releases, so that CI, the cluster and the audit each run a known version.
3. **Use what the platform already guarantees.** Keep S3 Block Public Access on at the account level, label namespaces for Pod Security Admission, and write custom rules only for what the built-in controls can't express.
4. **Check in CI first**, where feedback is cheapest. Evaluate the plan JSON rather than the `.tf` files, so that modules and variables are resolved, and show the result where the author looks (Conftest's `--output github` writes GitHub Actions annotations).
5. **Add admission control in warn mode, then deny.** Decide what happens when the webhook is down (Gatekeeper fails open by default and relies on the audit), and keep its latency within what the API server can afford.
6. **Run the audit continuously and route findings to owners**: one ticket for the team that owns each namespace or account, not one report for the platform team.
7. **Add a few account-level backstops** for actions nobody should take, such as a service control policy that denies `s3:PutAccountPublicAccessBlock` in member accounts, so nobody can switch off S3 Block Public Access for the account, plus AWS Config rules for detection.
8. **Treat exceptions as code**, each with an owner and an expiry date, and review the open ones regularly.
9. **Measure the effect**: the time from a failed check to its fix (2 minutes for PR #512), the share of pull requests that fail a check, how long rules stay in warn mode, open exceptions and their age, and audit findings per team. If people regularly wait for a person to resolve a failed check, the gate is back.

## Where it fits

- [Infrastructure as code](../infrastructure-as-code/) makes every change a plan that can be reviewed; policy as code checks every plan automatically, using the plan JSON as its input.
- [Kubernetes](../kubernetes/) admission control is the enforcement point for everything created in a cluster, whichever route it took.
- [Amazon S3](../amazon-s3/) and [AWS IAM](../aws-iam/) bring guardrails of their own: Block Public Access settings, and service control policies that cap what any IAM policy in a member account can allow.
- [Supply chain security](../supply-chain-security/) takes the image rule further: `registry-and-digest` says where an image comes from, while provenance and signature checks at admission show how it was built.
- [Golden paths](../golden-paths/) make compliance the default: when a template passes every rule, most teams never see a failed check.
- [Continuous delivery](../continuous-delivery/) runs policy checks as pipeline stages, and turns the approvals that remain into recorded steps instead of meetings.
- [Policy-based authorization](../policy-based-authorization/) uses the same engines for a different job: deciding application requests at runtime.
- [Zero trust access](../zero-trust-access/) evaluates an access policy on every request; that policy is one more set of rules worth keeping in version control, with tests.

## When to use it

Policy as code pays off when many teams share a platform and the rules can be read from configuration: resource settings, image sources, tags, network exposure, encryption. It pays off most where changes are frequent, because a three-day approval costs more with every change, and in regulated settings, where the evidence it leaves behind replaces collecting it by hand.

It costs more than it returns, or needs adapting, when:

- **The team is small.** With one or two services, platform defaults, a module that is private by default and a pull request template may be enough. Add a rule when a mistake repeats.
- **The rule needs judgement.** Whether a design is sound, whether data should be kept at all, what a threat model concludes: none of that can be read from a plan. Keep people reviewing those.
- **The platform already enforces it.** Built-in controls such as S3 Block Public Access, Pod Security Admission and service control policies are cheaper to run than custom code.
- **The estate is old.** Legacy systems may need warn mode and exceptions for a long time; plan for that instead of switching to deny on a date nobody can meet.
- **You can't run it reliably.** An admission webhook that fails closed makes every request to the API server depend on it. Either run it like part of the control plane, or choose to fail open (Gatekeeper's default) and rely on the audit as the safety net.

## Common pitfalls

- **Too many rules at once.** Sixty rules in the first week turn every build red, and teams find side doors such as deploying from a laptop or copying an exempt namespace. Start with the few rules that prevent real incidents, run each in warn mode first, and publish what is coming next.
- **Rules without tests.** A typo in an untested rule can block every deploy or let everything through. Give each rule passing and failing examples, run them in the policy repository's CI, and test against real plans and manifests too.
- **Unclear error messages.** `violation` tells the author nothing. Name the rule, the resource, what is wrong and how to fix it, link to the rule's page, and show the message in the pull request.
- **No exception process.** If the only way past a rule is to ask someone in chat, exceptions happen in the dark and never end. Record them as code with an owner and an expiry date, and let the audit report on them.
- **The same rule written for several engines.** Copies in Conftest, Gatekeeper and AWS Config drift apart: Acme's CI copy of `no-root` skipped init containers, so CI passed and admission rejected the deploy. Share one Rego library between Conftest and Gatekeeper (a constraint template can import library modules), share the test cases, and prefer a built-in control to a copy.
- **Treating it as a replacement for design review.** Rules check settings, not whether a design is sound: every check passed on the label exports while they kept customer addresses with no retention limit. Keep design and data reviews for new systems, and let rules handle the checks that repeat.
- **Rebuilding the gate.** If a failed check can only be resolved by a person who reviews in a weekly batch, the CAB is back under another name. Guardrails should give fast, self-service feedback, so that people spend their review time on designs and exceptions.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Policy-Based Authorization](../policy-based-authorization/) — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).
- [Infrastructure as Code](../infrastructure-as-code/) — Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.
- [Supply Chain Security (SLSA)](../supply-chain-security/) — Prove that what you deploy was built from your source: build provenance, SBOMs, signatures and a check before every deploy.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.

## References

- [Open Policy Agent — Documentation: decoupling policy decisions from enforcement](https://www.openpolicyagent.org/docs)
- [Open Policy Agent — Policy testing (opa test)](https://www.openpolicyagent.org/docs/policy-testing)
- [Open Policy Agent — Terraform (policies on plan JSON)](https://www.openpolicyagent.org/docs/terraform)
- [OPA blog — Announcing OPA 1.0 (December 2024)](https://www.openpolicyagent.org/blog/announcing-opa-1-0-a-new-standard-for-policy-as-code-a6d8427ee828)
- [OPA blog — Note from Teemu, Tim, and Torin to the OPA community (August 2025)](https://www.openpolicyagent.org/blog/note-from-teemu-tim-and-torin-to-the-open-policy-agent-community-2dbbfe494371)
- [Conftest — Documentation](https://www.conftest.dev/)
- [Conftest — Exceptions](https://www.conftest.dev/exceptions/)
- [OPA Gatekeeper — Handling constraint violations (deny, dryrun, warn)](https://open-policy-agent.github.io/gatekeeper/website/docs/violations/)
- [OPA Gatekeeper — Audit](https://open-policy-agent.github.io/gatekeeper/website/docs/audit/)
- [OPA Gatekeeper — Failing closed (the webhook fails open by default)](https://open-policy-agent.github.io/gatekeeper/website/docs/failing-closed/)
- [Kyverno — ValidatingPolicy (compared with ValidatingAdmissionPolicy)](https://kyverno.io/docs/policy-types/validating-policy/)
- [Kyverno — ClusterPolicy overview (deprecated in 1.19)](https://kyverno.io/docs/policy-types/cluster-policy/overview/)
- [Kubernetes documentation — Validating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/)
- [Kubernetes documentation — Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Kubernetes documentation — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [HashiCorp — Sentinel enforcement levels](https://developer.hashicorp.com/sentinel/docs/concepts/enforcement-levels)
- [HashiCorp — HCP Terraform policy enforcement overview](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement)
- [Cedar — What is Cedar?](https://docs.cedarpolicy.com/)
- [AWS Organizations — Service control policies (SCPs)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [AWS Config — Custom rules (Lambda and Guard)](https://docs.aws.amazon.com/config/latest/developerguide/evaluate-config_develop-rules.html)
- [AWS Control Tower — Control behavior: preventive, detective and proactive](https://docs.aws.amazon.com/controltower/latest/controlreference/control-behavior.html)
- [Amazon S3 — Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [DORA — Capabilities: Streamlining change approval](https://dora.dev/capabilities/streamlining-change-approval/)
- [CNCF — Open Policy Agent (graduated January 2021)](https://www.cncf.io/projects/open-policy-agent-opa/)
- [CNCF — Kyverno (graduated March 2026)](https://www.cncf.io/projects/kyverno/)
- [CNCF — Cedar (sandbox, accepted October 2025)](https://www.cncf.io/projects/cedar/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
