
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Infrastructure as Code

> Define infrastructure in version-controlled code: review a plan, apply it the same way in every environment and catch drift.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Infrastructure as Code" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/infrastructure-as-code.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Built by hand** | Before: the delivery team clicks the returns service's database, queue and bucket together in the AWS console, once per environment, following a 31-step wiki page that is 14 months old. Staging's database is encrypted and keeps 7 days of backups; production's has neither, and an inbound rule opening port 5432 to 198.51.100.0/24 appeared that nobody can explain. Nothing was reviewed, and rebuilding production by hand would take about 3 days. |
| **2 · Declare it, plan it** | `returns.tf` declares the three resources through the platform team's versioned modules, which build in encryption, backups, deletion protection and a dead-letter queue. Pull request #418 runs `terraform plan` in CI for each environment: **Plan: 10 to add, 0 to change, 0 to destroy**, since the modules also create the subnet group, the security group and its rules, the dead-letter queue and the bucket settings. All 12 policy rules pass on the plan, and the reviewers approve the plan as well as the code. |
| **3 · Apply it the same way** | After the merge, pipeline run #57 applies the same code to staging and then to production; only the `.tfvars` differ (instance class, Multi-AZ, 7 or 14 days of backups). Each environment has its own state file in S3 with a lock, and the pipeline retries for it with `-lock-timeout`, so run #58 waits until #57 has finished. A quarterly drill rebuilds production in us-west-2 from the same code in 40 minutes and restores the data from the latest snapshot copy (Acme's numbers). |
| **4 · Drift and pitfalls** | Someone opens port 5432 to `0.0.0.0/0` in the console; the nightly `plan -detailed-exitcode` exits with 2, and applying `main` again removes the rule. A hotfix that is really needed belongs in code, or the next apply undoes it. Read every plan: setting `kms_key_id` forces the database to be **replaced**, which `prevent_destroy` stops. Keep secrets out of the state or encrypt it, and split one huge state into one per service and environment. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's delivery team needed three things for its new returns service: a [PostgreSQL](../postgresql/) database on Amazon RDS, an SQS queue and an S3 bucket for return labels, each in staging and in production. The first time round they did it the familiar way. Someone followed the team's wiki page on setting up an environment, 31 steps last edited 14 months ago, and clicked through the AWS console: staging on Monday, production on Thursday.

The two environments came out different. Staging's database is encrypted and keeps seven days of automated backups. In production the encryption box was left unticked and the backup retention set to 0, which turns automated backups off. Neither is a quick fix: RDS can only encrypt an instance when it is created, so adding encryption later means restoring from an encrypted snapshot copy (or switching over with an RDS blue/green deployment), and the RDS documentation warns that changing the retention from 0 to a non-zero value causes an outage. The next morning, production's security group got an extra inbound rule for port 5432 from 198.51.100.0/24. Nobody remembers why it is there, so nobody dares to remove it.

None of these changes was reviewed, nothing records why they were made, and the only way to rebuild production after a disaster is to work through the wiki by hand, which would take about three days. The same story repeats for every service and every new environment. (Acme's numbers on this page are the example's own, not research findings.)

## How it works

**Infrastructure as code** (IaC) means defining infrastructure, such as networks, databases, queues, buckets and permissions, in source files that live in version control and are treated like any other software: reviewed, tested and delivered through a pipeline. Martin Fowler's bliki entry on it (2016) sums up the practices: use definition files instead of logging in to make changes, let the code document the system instead of instructions written for people, version everything, test continuously, prefer small changes to big batches, and keep services available while they change.

The standard text is Kief Morris's *Infrastructure as Code*. Its third edition (O'Reilly, 2025) puts less weight on types of tools than the second (2020) and more on how infrastructure code is designed and delivered to serve the organisation. It keeps three core practices: **define everything as code**, **continually test and deliver all work in progress**, and **build small, simple pieces that can change independently**. Its principles of cloud infrastructure include assuming systems are unreliable, making everything reproducible, avoiding snowflake systems, creating disposable things, minimizing variation and making sure any procedure can be repeated. The chapters on delivery apply continuous delivery to infrastructure: make changes only through the automated process, and keep the code and the deployed resources consistent.

### Declare, plan, apply

Most provisioning tools are **declarative**: the code says what should exist (a database with these settings, a queue, a bucket), and the tool works out the steps. Terraform and OpenTofu compare three things: the configuration, the **state** (their record of which real object each resource in the code corresponds to) and the real infrastructure, which they refresh through the cloud's APIs. `plan` prints the difference as a list of actions (`+` create, `~` update in place, `-/+` replace, `-` destroy) that ends with a summary such as `Plan: 10 to add, 0 to change, 0 to destroy.`, and `apply` carries them out. Run `apply` again with nothing changed and it does nothing. That **idempotence** is what makes it safe to apply the same code again and again, in every environment.

An **imperative** script, such as a series of `aws` CLI calls, describes the steps instead, and running it twice may try to create everything twice. Tools that let you write infrastructure in a general-purpose language keep a declarative core: an AWS CDK app generates a CloudFormation template, and a Pulumi program registers the resources it wants with Pulumi's engine, which works out the changes. Configuration-management tools such as Ansible apply the idea to what runs on servers; Ansible's documentation defines an idempotent operation as one that gives the same result whether it runs once or many times.

### State and locking

The state file is how Terraform knows that `module.db.aws_db_instance.this` is the production database `returns-db`. Keep it in a **remote backend** that everyone and the pipeline share; Acme uses an S3 bucket with one state file per service and environment (`returns/staging.tfstate`, `returns/production.tfstate`), with versioning turned on so a damaged state can be recovered. A **lock** stops two runs from changing the same state at once. By default a run that finds the state locked fails straight away; Acme's pipeline passes `-lock-timeout`, so run #58 keeps retrying and waits for run #57 instead. Terraform's S3 backend added native locking with a lock file next to the state (`use_lockfile = true`) in version 1.10 (November 2024); it became generally available in 1.11 (February 2025), which deprecated the older DynamoDB-based locking. OpenTofu added S3-native locking in 1.10 and supports both methods, with no plans to deprecate either.

### Modules and environments

Acme's platform team publishes versioned **modules**: `rds-postgres` turns on encryption, at least seven days of backups, deletion protection and `prevent_destroy`; `sqs-queue` adds a dead-letter queue; `s3-bucket` turns on versioning and blocks public access. Product teams get those settings without having to remember them. `returns.tf` calls each module once, and each environment differs only in its small variables file: the instance class, Multi-AZ and the backup retention. That is Morris's *minimize variation* in practice: staging and production are built from the same code, so any difference between them is a deliberate value in a file. The modules also explain the plan's count: three modules create 10 resources, because they add the subnet group, the security group and its rules, the dead-letter queue, versioning and the public access block.

### Testing

- **Static checks** on every commit: `terraform fmt -check`, `terraform validate`, and scanners such as Checkov or Trivy (which absorbed tfsec).
- **The plan as a review artifact.** CI runs a plan for each environment and posts it on the pull request (Atlantis and the hosted Terraform services do this), so reviewers approve the actions, not only the diff of the code.
- **Policy checks on the plan.** `terraform show -json` turns the plan into data that rules can check: Open Policy Agent rules through Conftest, Checkov, or HashiCorp Sentinel in HCP Terraform. Acme's 12 rules reject, among others, an unencrypted database, backups under seven days, ingress from `0.0.0.0/0` and a public bucket. This is [policy as code](../policy-as-code/) applied to infrastructure.
- **Module tests.** `terraform test` (generally available since Terraform 1.6) runs `.tftest.hcl` files that plan or apply a module and check conditions on the result; Terratest does the same in Go.
- **Smoke and integration tests** against the real environment after each apply, before the pipeline moves on to production.

### Drift

**Drift** is any difference between the code and reality, usually a change made outside the code. A scheduled `terraform plan -detailed-exitcode` finds it (exit code 2 means the plan has changes), and `-refresh-only` shows only what changed outside Terraform. HCP Terraform's health assessments (Standard and Premium editions) run drift detection periodically, CloudFormation can detect drift on a stack, and the CDK CLI has `cdk drift`. Two limits matter. First, a plan sees only what the code manages: a security group rule added by hand is a separate object, invisible to Terraform unless something owns the whole rule set. Acme's module uses the AWS provider's `aws_vpc_security_group_rules_exclusive` resource (provider 6.29, January 2026), which removes any rule that is not in the code. Second, a drift check only reports: someone still decides whether to revert the change or write it into the code.

### The tools today (October 2026)

- **Terraform** (HashiCorp, part of IBM since IBM completed the acquisition on 27 February 2025) is a widely used declarative tool, with providers for most clouds and many SaaS products. On 10 August 2023 HashiCorp moved it from the open-source MPL 2.0 to the Business Source License 1.1, which covers Terraform 1.6.0 and later.
- **OpenTofu** is a fork of the last MPL-licensed Terraform, started in response to that change. It is a Linux Foundation project, stable since 1.6.0 (January 2024), accepted into the CNCF as a sandbox project in April 2025, and still MPL 2.0. It started as a drop-in replacement and uses the same providers; since then the two have added different features, OpenTofu's own including client-side state and plan encryption (1.7).
- **AWS CloudFormation** is AWS's own declarative service, with templates in JSON or YAML, change sets to preview an update, drift detection, and an IaC generator that drafts templates from existing resources. The **AWS CDK** generates CloudFormation from TypeScript, JavaScript, Python, Java, C#/.NET or Go.
- **Pulumi** defines infrastructure in TypeScript or JavaScript, Python, Go, .NET, Java or YAML; its engine is open source under Apache 2.0.
- **Crossplane** manages cloud resources as [Kubernetes](../kubernetes/) custom resources and keeps reconciling them, like a GitOps agent; it graduated in the CNCF in October 2025.
- **Ansible** (Red Hat, also IBM) is agentless automation, used mostly to configure what runs on servers and network devices, often next to a provisioning tool.

**GitOps** applies the same idea to Kubernetes with one difference: instead of a pipeline pushing a plan, an agent inside the cluster pulls the desired state from Git and keeps reconciling it, so drift is corrected continuously rather than found at the next plan. See [GitOps](../gitops/).

### Secrets

Terraform writes resource attributes to the state and plan files, including secrets such as an initial database password set in the configuration. Keep secrets out of it where you can: let RDS manage the master password in AWS Secrets Manager (`manage_master_user_password`), and use write-only arguments such as `password_wo` (Terraform 1.11 and later), which are never stored, or ephemeral values (1.10 and later). Treat the state as sensitive anyway: encrypt it (server-side encryption with a KMS key on the S3 backend, or OpenTofu's state encryption), restrict who can read it, and never commit it to Git.

## Putting it into practice

1. **Choose a tool and set up the state first.** AWS-only teams can use CloudFormation or the CDK and run no state backend at all; teams spanning clouds and SaaS products often pick Terraform or OpenTofu. Create the state bucket with versioning, encryption, a lock and tight access before the first resource.
2. **Bring existing resources under code** with `import` blocks (Terraform 1.5 and later; OpenTofu has them too) instead of rebuilding them, and adjust the code until the plan shows no changes. Fix what the import reveals deliberately: on an imported database that was created unencrypted, like Acme's hand-built production one, setting `storage_encrypted = true` forces a replacement, so the encryption fix is a planned migration from an encrypted snapshot copy.
3. **Put the guardrails into shared modules** (encryption, backups, deletion protection, tags, logging) and version them with Git tags or a private registry, so teams upgrade on purpose. Golden-path templates can then start every new service with them.
4. **Give each service one configuration and each environment its own state and variables file.** Copying a folder per environment brings back the drift you were trying to remove, only in code.
5. **Make the pipeline the only way to change infrastructure:** a plan for every environment on every pull request, policy checks on the plan, a review that reads the plan, then apply after merge, staging before production. Give the pipeline's role write access (through OpenID Connect rather than long-lived keys) and give people read-only access to production, with a recorded break-glass procedure for emergencies.
6. **Pin providers and modules** and commit `.terraform.lock.hcl`, so a provider upgrade arrives as its own reviewed change instead of a surprise in someone's plan.
7. **Check for drift on a schedule** and send it to the team that owns the code; Acme runs a plan every night at 02:00.
8. **Rehearse a rebuild.** Acme applies the production configuration in us-west-2 once a quarter: the infrastructure takes 40 minutes, then the data is restored from the latest cross-region snapshot copy. The code rebuilds resources, not data, so the backups still decide your RPO.

## Where it fits

- [Immutable infrastructure](../immutable-infrastructure/) replaces servers from baked images instead of patching them; infrastructure as code defines everything around them, and the image version becomes one more value in the code.
- [GitOps](../gitops/) is the pull-based form of the same idea for Kubernetes: an agent keeps the cluster in sync with Git.
- [Continuous delivery](../continuous-delivery/): infrastructure code goes through a deployment pipeline like application code, and the same code is tested and applied to staging before production.
- [Golden paths](../golden-paths/) start new services with infrastructure code and the platform's modules already in place, and policy as code checks every plan against the organisation's rules.
- [Disaster recovery strategies](../disaster-recovery-strategies/): backup and restore rebuilds the infrastructure from code in another region, and pilot light uses the same code to scale the recovery region up.
- [Eliminating toil](../eliminating-toil/): a module plus a pull request turns a ticket ("create a database user", "give us a bucket") into self-service.
- [Expand and contract](../expand-and-contract/) and [blue-green deployment](../blue-green-deployment/) are how to change live stateful resources without a replace: add the new one, move the traffic or data, then remove the old one.
- [You build it, you run it](../you-build-it-you-run-it/): the product team owns its infrastructure code; the platform team owns the modules and the pipeline.
- The resources on this page: [Amazon RDS and Aurora](../amazon-rds-aurora/), [Amazon SQS](../amazon-sqs/), [Amazon S3](../amazon-s3/), security groups in [Amazon VPC](../amazon-vpc/), the pipeline's role in [AWS IAM](../aws-iam/), and secrets in AWS Secrets Manager or [Vault](../vault/).

## When to use it

Infrastructure as code pays off for anything that will outlive an experiment, exists in more than one environment, or must be rebuilt, reviewed or audited: production systems, shared platforms used by many teams, and regulated workloads, where every change becomes a reviewed commit with a recorded plan, policy result and approver.

It has real costs. The team has to learn the tool and its state model, keep the state secure, keep providers and modules up to date, and accept that a one-off change now takes a pull request and a pipeline run. Adapt it to the situation:

- **A small team or a single environment:** one configuration, a remote state, and plans on pull requests are enough. Write modules when the repetition appears, not before.
- **Exploration:** clicking around in a sandbox account is fine for learning a service. Turn the result into code, or delete it, before anything depends on it; `import` blocks with the experimental `-generate-config-out` option and CloudFormation's IaC generator can draft the first version of the code.
- **Legacy and on-premises estates:** start with what changes most often or hurts most to rebuild, and import rather than recreate.
- **Regulated environments:** keep the plan output, policy results and approvals of each change; they are the audit trail.

It is not the tool for data inside the resources. The code creates the database, not its rows: schema migrations belong to the application's pipeline, and backups and restores to the disaster recovery plan.

## Common pitfalls

- **Applying a plan nobody read.** A plan that says `must be replaced` on a database means destroy and recreate: a new, empty database. Some arguments always force it, such as `kms_key_id` or `storage_encrypted` on `aws_db_instance`. Renaming a resource has the same effect, a destroy at the old address and a create at the new one, unless a `moved` block (Terraform 1.1 and later) records the rename. Read every plan, and protect stateful resources twice: `prevent_destroy` makes Terraform reject any plan that would destroy the resource (though not one where the resource block itself was deleted), and RDS deletion protection makes AWS refuse the delete. When the change is really needed, migrate the data on purpose.
- **Secrets in the state file.** A password set in the configuration ends up in the state and plan files in plain text, readable by anyone who can read the bucket. Encrypt and restrict the state, and keep secrets out of it with RDS-managed passwords, write-only arguments or ephemeral values.
- **One huge state for everything.** Put all of Acme's 2,300 resources in one state and every plan takes 9 minutes, one lock blocks every team, and one mistake can reach anything. Split the state by service and environment, so each change has a small blast radius.
- **Manual hotfixes never written back.** A fix made in the console during an incident is drift. If nobody writes it into the code, the next apply quietly undoes it, or the drift stays and nobody knows which version is right. Write it back the same day, and keep the console read-only outside break-glass.
- **Copy-pasted environments.** A `staging/` and a `production/` folder with copied code drift apart in code just as click-ops environments do. Use one configuration with a variables file per environment, or thin per-environment roots that call the same modules.
- **Drift the plan can't see.** Resources created by hand, or rules attached as separate objects, never appear in a plan. Import them or own the whole set, as `aws_vpc_security_group_rules_exclusive` does for security group rules, and back the plan with detective controls such as AWS Config rules.
- **Long-lived admin keys in CI.** A pipeline that can change everything is a prime target. Give it a role it assumes through OpenID Connect, one per environment, so a run for staging can't touch production.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.
- [Golden Paths](../golden-paths/) — A paved, supported route for common tasks: one template creates a service with its pipeline, infrastructure and monitoring.
- [Eliminating Toil](../eliminating-toil/) — Find the manual, repetitive operations work that grows with the system, measure it, cap it and automate it away.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Disaster Recovery Strategies](../disaster-recovery-strategies/) — Backup & restore, pilot light, warm standby, active-active: trading cost against RTO and RPO.
- [Amazon VPC](../amazon-vpc/) — Your private network in AWS: subnets in each Availability Zone, route tables, gateways, security groups and endpoints.

## References

- [Kief Morris — Infrastructure as Code, third edition (O'Reilly, 2025)](https://infrastructure-as-code.com/book/)
- [Martin Fowler — InfrastructureAsCode (2016)](https://martinfowler.com/bliki/InfrastructureAsCode.html)
- [Terraform documentation — terraform plan command reference](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform documentation — Backend type: s3 (state locking)](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Terraform documentation — Manage sensitive data](https://developer.hashicorp.com/terraform/language/state/sensitive-data)
- [Terraform documentation — lifecycle meta-argument (prevent_destroy)](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
- [Terraform documentation — Refactor modules (moved blocks)](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform documentation — Tests](https://developer.hashicorp.com/terraform/language/tests)
- [HCP Terraform — Health assessments (drift detection)](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/health)
- [HashiCorp — Terraform licence: Business Source License 1.1, Terraform 1.6.0 and later](https://github.com/hashicorp/terraform/blob/main/LICENSE)
- [IBM — IBM completes acquisition of HashiCorp (27 February 2025)](https://newsroom.ibm.com/2025-02-27-ibm-completes-acquisition-of-hashicorp,-creates-comprehensive,-end-to-end-hybrid-cloud-platform)
- [OpenTofu — Manifesto (2023)](https://opentofu.org/manifesto/)
- [OpenTofu documentation — State and plan encryption](https://opentofu.org/docs/language/state/encryption/)
- [CNCF — OpenTofu (sandbox project since April 2025)](https://www.cncf.io/projects/opentofu/)
- [AWS CloudFormation User Guide — Drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
- [AWS CDK Developer Guide — What is the AWS CDK?](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- [Pulumi documentation — Languages and SDKs](https://www.pulumi.com/docs/iac/languages-sdks/)
- [CNCF — Crossplane (graduated October 2025)](https://www.cncf.io/projects/crossplane/)
- [Ansible documentation — Glossary (idempotency)](https://docs.ansible.com/ansible/latest/reference_appendices/glossary.html)
- [Amazon RDS User Guide — Encrypting Amazon RDS resources](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Amazon RDS User Guide — Backup retention period](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
- [Terraform AWS provider — aws_vpc_security_group_rules_exclusive](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/vpc_security_group_rules_exclusive.html.markdown)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
