<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🟧 AWS Services](../../README.md#aws-services)

# AWS IAM

> Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.

<p align="center"><img src="diagram.svg" alt="Animated diagram: AWS IAM" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/aws-iam.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Requests to AWS APIs are signed with credentials (**Signature Version 4**); IAM authenticates the signature, then evaluates the policies before the service acts. In the photo app, `make-thumbnail` calls S3 with its **execution role** `thumbnailer-role`, a developer signs in through **IAM Identity Center** with MFA and works in the role of the `PhotoDev` permission set, and GitHub Actions trades its **OIDC** token for the role `gha-deploy`. Other workloads get roles the same way (ECS task roles, EC2 instance profiles), and other accounts reach in through cross-account roles. |
| **2 · Temporary credentials** | When `make-thumbnail` runs, Lambda assumes `thumbnailer-role`, which the role's **trust policy** allows for the service principal `lambda.amazonaws.com`, and AWS STS returns **temporary credentials**: an access key ID that starts with `ASIA`, a secret access key, a session token and an expiration time. Lambda hands them to the function as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`; the SDK signs each S3 request with a key derived from the secret and sends the token along. No secret is stored in the code or the image, and the credentials stop working when they expire. |
| **3 · Evaluating a request** | Three calls on `u/9f3c/IMG_0042.jpg`. **GetObject over HTTPS**: no Deny applies, the organization's SCPs and RCPs allow it and the identity policy allows it, so S3 returns the photo. **DeleteObject**: no policy allows it, so it ends in an **implicit deny** (403 `AccessDenied`). **GetObject over plain HTTP**: the bucket policy denies requests where `aws:SecureTransport` is `false`, and that **explicit deny** beats any Allow. Permissions boundaries and session policies, where present, only narrow what the other policies allow. |
| **4 · Least privilege, limits** | Least privilege is hard to write by hand: start narrow, and let **IAM Access Analyzer** check roles against CloudTrail. Here it finds most of the AWS managed policy `AWSLambda_FullAccess` unused by `gha-deploy` over 90 days, and drafts a policy from the calls the role made, such as `lambda:UpdateFunctionCode`. The limits (October 2026): a managed policy holds 6,144 characters and a role's inline policies 10,240 in total; an AssumeRole session lasts 15 minutes to 12 hours (1 hour by default); and IAM is **eventually consistent**, so a change takes time to reach every endpoint. A long-lived access key (`AKIA…`) works until it is deactivated or deleted, so prefer roles and federation, require MFA for people, and keep the root user for the few tasks that need it. |
<!-- END GENERATED: header -->

## The problem

The photo app lives in one AWS account. The `make-thumbnail` function reads uploads from the bucket `photos-prod` and writes thumbnails back, a GitHub Actions workflow deploys new versions of the function, and developers look at logs and at the bucket when something breaks. All of them reach AWS through the same public APIs, so every call has to settle two questions before anything happens: who is calling, and may that identity do this to that resource?

The quick answers are the dangerous ones. An access key pasted into the function's configuration or into a CI secret works from anywhere until someone deletes it, and keys leak through code, container images and build logs. A policy of `s3:*` on `*` saves an afternoon with the documentation and lets a bug, or whoever holds the key, delete every photo. And the people who need access change every month.

## How it works

AWS Identity and Access Management (IAM) authenticates and authorizes requests to AWS APIs for every service in an account. There is nothing to deploy or pay for: IAM, IAM Identity Center and AWS STS are offered at no additional charge (October 2026).

### Principals: who is calling

- **The root user** is the identity created with the account, and it has full access to everything in it. AWS recommends using it only for the few tasks that require it, and enforces MFA for it. In AWS Organizations, centralized root access lets you delete the root credentials of member accounts altogether.
- **IAM users** have long-term credentials: a console password and at most two access keys, whose IDs start with `AKIA`. A key keeps working until it is deactivated or deleted, which is why AWS recommends IAM users only for the cases that federation can't serve.
- **Roles** have no long-term credentials. A role has a **trust policy**, naming who may assume it, and **permissions policies**, saying what its sessions may do. Whoever assumes it gets temporary credentials from AWS STS. Workloads receive roles from the service that runs them: a Lambda execution role, an [ECS](../amazon-ecs/) task role, an EC2 instance profile. Service-linked roles are predefined by an AWS service for its own work.
- **Federated identities** come from an identity provider outside IAM and use a role while they work: people through IAM Identity Center, CI systems and other workloads through OpenID Connect (`AssumeRoleWithWebIdentity`) or SAML 2.0 (`AssumeRoleWithSAML`), and an application's own end users through [Amazon Cognito](../amazon-cognito/) identity pools.

### Authentication: proving it

- **Signature Version 4.** The SDK builds a canonical form of the request (method, path, query, headers and a hash of the body) and signs it with a key derived from the secret access key for that day, Region and service. AWS recomputes the signature, so the secret never travels, a request altered in transit fails, and in most cases a request must arrive within five minutes of its timestamp. With temporary credentials the request also carries the session token, in `X-Amz-Security-Token`. SigV4a, an asymmetric variant, signs requests that may be served in several Regions, such as those to S3 Multi-Region Access Points. A few calls carry a token instead of a signature: `AssumeRoleWithWebIdentity` needs no AWS credentials, because the identity provider's token is the proof.
- **MFA.** The root user and IAM users can register passkeys or security keys (FIDO-based and phishing-resistant), authenticator apps or hardware TOTP tokens, and a policy can demand MFA for sensitive actions with the condition key `aws:MultiFactorAuthPresent`.
- **IAM Identity Center** is AWS's recommended front door for people. Users sign in once to the AWS access portal, against Identity Center's own directory or an external identity provider over SAML 2.0, and pick an account and a **permission set**. A permission set is a template: Identity Center creates a matching IAM role in every account it is assigned to, and hands the user that role's temporary credentials for the console or the CLI. Sessions last 1 hour by default and can be set up to 12 hours per permission set.

### Policies: what is allowed

Most policies are JSON documents in the policy language version `2012-10-17`. Each statement has an `Effect` (`Allow` or `Deny`), the `Action`s it covers (`s3:GetObject`; wildcards work), the `Resource`s it covers by ARN, optional `Condition`s on the request context (`aws:SecureTransport`, `aws:SourceIp`, `aws:PrincipalTag/team`, `s3:prefix` …) and, in resource-based policies only, the `Principal` it applies to. `NotAction`, `NotResource` and `NotPrincipal` match everything except a list.

The IAM User Guide lists nine policy types as of October 2026. These are the ones most designs touch:

| Type | Attached to | Grants access? | In the photo app |
|---|---|---|---|
| Identity-based, managed or inline | users, groups, roles | yes | `thumbnailer-role` may read `u/*` and write `thumbnails/*` |
| Resource-based | a resource: S3 bucket policy, KMS key policy, SQS queue policy, a role's trust policy | yes, also to other accounts | `photos-prod` refuses requests without TLS |
| Permissions boundary | a user or role (a managed policy) | no: caps what identity-based policies can grant | none |
| Service control policy (SCP) | an organization's root, OUs or accounts | no: caps what principals in member accounts can do | the default `FullAWSAccess` |
| Resource control policy (RCP), since November 2024 | an organization's root, OUs or accounts | no: caps what can be done to resources in member accounts | the default `RCPFullAWSAccess` |
| Session policy | one role or federated session, passed when it starts | no: caps that session | none |
| Access control list (ACL) | resources in S3, VPC and AWS WAF | yes, to other accounts only | disabled, the default for new buckets |

VPC endpoint policies and AWS RAM resource shares complete the nine. Managed policies come from AWS (`AWSLambdaBasicExecutionRole`, `AWSLambda_FullAccess`) or from you; AWS managed policies are a quick start, but they are written for many workloads and usually grant more than one of them needs.

### How a request is evaluated

For every request IAM assembles a request context (the principal, the action, the resource, and facts such as the time, the source IP and whether TLS was used) and evaluates every policy that applies. Within one account the AWS enforcement code works in this order:

1. **Explicit deny.** It looks for a matching `Deny` statement in all of them: SCPs, RCPs, resource-based and identity-based policies, permissions boundaries and session policies. One is enough: the decision is Deny, whatever else allows the request.
2. **RCPs, then SCPs.** If the account belongs to an organization that uses them, they must allow the action. They never grant anything by themselves.
3. **Resource-based policy.** An Allow here can settle it within the same account. If it names the role session or the IAM user directly, the decision is Allow even when the identity-based policies, a boundary or a session policy say nothing; if it names the role's ARN, a boundary and a session policy still apply.
4. **Identity-based policies.** If none allows the action, and no resource-based policy already did, the request is implicitly denied.
5. **Permissions boundary**, if the user or role has one, must allow it as well.
6. **Session policy**, if the session started with one, must allow it as well. Then the decision is Allow.

Everything starts as an **implicit deny**, except for the root user. Two kinds of resource-based policy are stricter than the rest: a role's trust policy and a KMS key policy must allow the principal themselves, even inside one account. **Across accounts** both sides must agree: the caller's identity-based policy in its own account and the resource-based policy (or the role's trust policy) in the other account.

The three calls of step 3, all made by `thumbnailer-role`:

| Request | What decides it | Result |
|---|---|---|
| `GetObject u/9f3c/IMG_0042.jpg` over HTTPS | no Deny applies; SCPs and RCPs allow; the identity policy allows `photos-prod/u/*` | 200 OK |
| `DeleteObject u/9f3c/IMG_0042.jpg` | no Deny applies, but no policy allows `s3:DeleteObject` | implicit deny: 403 `AccessDenied` |
| `GetObject u/9f3c/IMG_0042.jpg` over plain HTTP | the bucket policy denies `s3:*` when `aws:SecureTransport` is `false` | explicit deny: 403 `AccessDenied` |

For callers in the same account or organization, S3's 403 message says which kind of policy denied the request and why (for the second call: no identity-based policy allows the `s3:DeleteObject` action), and for an explicit deny in an SCP, RCP, identity-based policy, session policy or boundary it includes that policy's ARN.

### Roles and AWS STS

AWS STS issues every set of temporary credentials: an access key ID that starts with `ASIA`, a secret access key, a session token and an expiration time. Lambda assumes `thumbnailer-role` by itself whenever the function runs and passes the credentials in as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`, where the SDK finds them; the function's code doesn't call STS itself. The STS operations:

- **`AssumeRole`.** The role's trust policy must allow the caller; a caller from another account also needs its own identity-based policy to allow `sts:AssumeRole` on the role. `DurationSeconds` runs from 900 seconds up to the role's maximum session duration, which you set between 1 and 12 hours; without it the session lasts 1 hour. A role session that assumes another role (role chaining) is limited to 1 hour, and the maximum doesn't limit sessions that AWS services assume themselves.
- **`AssumeRoleWithWebIdentity`** trades a token from an OIDC provider registered in IAM for role credentials, and **`AssumeRoleWithSAML`** does the same with a SAML assertion. The trust policy checks the token's claims, such as its audience and subject.
- **Session policies and session tags.** The caller can pass a session policy and up to 10 managed policy ARNs, 2,048 characters in all, to narrow one session, and tags that ABAC policies can test. Both make the session token larger.
- **External ID.** A vendor that assumes roles in its customers' accounts gives each customer a unique external ID, and the customer's trust policy requires it with the condition key `sts:ExternalId`. This prevents the confused deputy problem: another customer of the same vendor can't get the vendor to act on your account. AWS doesn't treat the external ID as a secret. When an AWS service principal acts for you, the same protection comes from `aws:SourceArn`, `aws:SourceAccount` or `aws:SourceOrgID` conditions in the resource-based policy.
- **Revocation.** Temporary credentials are valid until they expire. To cut a role's sessions off early, *Revoke active sessions* in the IAM console attaches an inline policy, `AWSRevokeOlderSessions`, that denies everything to sessions issued before that moment.

### Attribute-based access control

With one role per job (role-based access control), the number of roles and policies grows with every new team and project. Attribute-based access control (ABAC) writes fewer, more general statements that compare tags, for example allowing an action only when the resource's `aws:ResourceTag/project` equals the caller's `aws:PrincipalTag/project`. Session tags from the identity provider can carry a person's project or cost centre into the session. New resources are covered without editing policies, but only while the tags are trustworthy: who may set or change a tag (`aws:RequestTag`, `aws:TagKeys`) needs as much care as the policies themselves.

### Auditing and tightening: CloudTrail and IAM Access Analyzer

**AWS CloudTrail** records API calls together with the identity that made them, down to each role session. Its event history keeps 90 days of management events, free to view; a trail keeps events longer in S3, and data events, such as reads and writes of S3 objects, are recorded only when you turn them on, at an extra charge.

**IAM Access Analyzer** turns that record into least privilege. In the photo app, `gha-deploy` started with the AWS managed policy `AWSLambda_FullAccess`; after 90 days the unused-access findings show most of it unused, and policy generation drafts a replacement from the calls the pipeline really made, such as `lambda:UpdateFunctionCode`, to which you add the function's ARN. The features:

- **Policy generation** (no additional charge) reads up to 90 days of one role's or user's CloudTrail activity and drafts a policy from it. It lists individual actions for the services it supports and only the service elsewhere. It can't see actions behind data events, such as S3 `GetObject`, and it never includes `iam:PassRole`, which CloudTrail doesn't track.
- **Unused access findings** (charged per IAM role or user analyzed each month) report unused roles, unused access keys and passwords, and the services and actions that active roles and users haven't used during a tracking period you choose, from 1 to 365 days.
- **External access findings** (no additional charge) report resources shared outside your account or organization; **internal access findings** (charged) show which roles and users inside it can reach resources you mark as critical.
- **Policy validation** (no additional charge) checks grammar and best practices while you write a policy, and **custom policy checks** (charged per check), such as `CheckNoNewAccess` and `CheckAccessNotGranted`, use automated reasoning to stop a policy change in a pipeline before it grants new access.

## Where it fits

- **Solutions.** Every AWS solution, since every API call passes through it. The design questions are where identities come from (Identity Center for people, roles for workloads, OIDC for CI and other platforms, cross-account roles between accounts and for vendors), how permissions are cut (a role per workload, ABAC for many similar resources), and which guardrails the organization sets above all accounts (SCPs and RCPs).
- **Patterns in this catalog.** IAM is how AWS applies [zero trust access](../zero-trust-access/): identity and policies are checked on every request, wherever it comes from. Its JSON policies and evaluation engine are a built-in [policy-based authorization](../policy-based-authorization/) system, with ABAC as its attribute-based style. With IAM Identity Center and OIDC providers it is the relying party in [federated identity](../federated-identity/), over [SAML 2.0](../saml-sso/) or [OpenID Connect](../openid-connect/). `AssumeRoleWithWebIdentity` is a form of [token exchange](../token-exchange/): an external token goes in, and short-lived credentials for a different identity come out. S3 presigned URLs are AWS's [valet key](../valet-key/): the URL carries the permissions of whoever signed it, and one signed with temporary credentials stops working when they expire.
- **Usual neighbours.** AWS STS, IAM Identity Center, AWS Organizations, CloudTrail, IAM Access Analyzer, AWS KMS key policies, Amazon Cognito for an application's own users, and every service with a resource-based policy, such as [Amazon S3](../amazon-s3/), [Amazon SQS](../amazon-sqs/) and [AWS Lambda](../aws-lambda/).
- **Managed offerings.** IAM is part of every AWS account; there is nothing to run. Its counterparts are Azure RBAC with Microsoft Entra ID and Google Cloud IAM.

## When to use it

On AWS, IAM isn't optional; the choice is between its mechanisms:

- **People:** IAM Identity Center with MFA, federated from the company's identity provider if it has one. IAM users only where long-term credentials are unavoidable, with their keys rotated and watched.
- **Workloads on AWS:** one role per workload, attached by the service that runs it, and no access keys in configuration.
- **Workloads elsewhere:** OIDC federation where the platform issues tokens (GitHub Actions, GitLab, [Kubernetes](../kubernetes/)), and IAM Roles Anywhere for servers that hold X.509 certificates from your own certificate authority.
- **Many accounts:** AWS Organizations with SCPs and RCPs as guardrails, Identity Center for people, and cross-account roles between workloads.
- **Your application's users:** not IAM. Amazon Cognito or another OpenID Connect provider signs them in, and a Cognito identity pool can map them to roles when they must call AWS directly.

Compared with the other two large clouds (October 2026):

| | AWS IAM | Azure RBAC with Microsoft Entra ID | Google Cloud IAM |
|---|---|---|---|
| People | IAM Identity Center (own directory or SAML 2.0 federation) | Microsoft Entra ID users and groups | Google accounts and groups, Cloud Identity, Workforce Identity Federation |
| Workloads | roles: Lambda execution roles, ECS task roles, EC2 instance profiles | managed identities and service principals | service accounts |
| Permissions written as | JSON policies on identities and on resources | role definitions assigned to a principal at a scope | roles granted to principals in allow policies on resources |
| Hierarchy | accounts in organization OUs; SCPs and RCPs set the ceiling | management group → subscription → resource group → resource, inherited | organization → folders → projects → resources, inherited |
| Deny | an explicit `Deny` in any policy, plus boundaries, SCPs and RCPs | deny assignments, created by Azure (for example through deployment stacks), not directly by you | deny policies, checked before allow policies |
| CI without stored keys | OIDC provider and `AssumeRoleWithWebIdentity` | workload identity federation, for example from GitHub Actions | Workload Identity Federation (GitHub, GitLab, any OIDC or SAML 2.0 provider) |
| Without a grant | implicit deny (the root user aside) | no access; role assignments add up | no access; role bindings add up, deny policies subtract |

## Trade-offs

- **Fine-grained, and hard to read.** Six kinds of policy can take part in one decision, and their interplay, such as a resource-based policy that names a role session rather than the role, surprises experienced engineers. S3's detailed 403 messages, the policy simulator and Access Analyzer help; the simulator evaluates identity-based policies and SCPs, but not RCPs, and it can't simulate resource-based policies for roles.
- **Least privilege takes iterations.** Nobody knows every action a function will call before it runs, AWS managed policies are broad, and a generated policy needs review and real resource ARNs. Start narrow and widen on evidence; tightening a broad policy later means proving that nothing still needs what you remove.
- **Eventual consistency.** IAM replicates changes between servers and Regions and caches them, so a new role or an edited policy takes time to take effect everywhere. AWS's advice: keep IAM changes out of critical, high-availability code paths, make them in setup or deployment steps, and confirm they have propagated before production depends on them.
- **Quotas** (October 2026): 6,144 characters per managed policy and 10,240 for all of a role's inline policies together (whitespace isn't counted); 2,048 characters per trust policy by default, raisable to 8,192; 20 managed policies per role by default, at most 25; 1,000 roles per account by default, at most 10,000. In AWS Organizations an SCP holds 10,240 characters and an RCP 5,120, and each root, OU or account takes at most 10 SCPs and 5 RCPs.
- **Credentials can't be recalled one by one.** A leaked session works until it expires unless you revoke all of the role's older sessions, and a leaked access key works until someone deactivates or deletes it.
- **Cost.** IAM, Identity Center and STS are free. CloudTrail data events and any copy of management events beyond the first, free one, and Access Analyzer's unused-access, internal-access and custom-check features, are charged.
- **AWS-specific.** ARNs, actions and condition keys don't carry over to other clouds. A multi-cloud company usually keeps one identity provider and maps its groups to each cloud's roles.

## Implementation notes

**The execution role.** The trust policy lets the Lambda service assume the role; the permissions policy covers exactly the two prefixes, and the AWS managed policy `AWSLambdaBasicExecutionRole` adds the [CloudWatch](../amazon-cloudwatch/) Logs permissions every function needs:

```sh
aws iam create-role --role-name thumbnailer-role \
  --assume-role-policy-document file://trust.json
aws iam put-role-policy --role-name thumbnailer-role \
  --policy-name photos-prod-access --policy-document file://photos.json
aws iam attach-role-policy --role-name thumbnailer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

`trust.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

`photos.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadOriginals", "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::photos-prod/u/*" },
    { "Sid": "WriteThumbnails", "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::photos-prod/thumbnails/*" }
  ]
}
```

**The bucket policy** refuses plain HTTP for every caller, the role included:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "RestrictToTLSRequestsOnly",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::photos-prod", "arn:aws:s3:::photos-prod/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

**GitHub Actions without keys.** Register `https://token.actions.githubusercontent.com` in IAM as an OIDC provider with the audience `sts.amazonaws.com`, and pin the trust policy of `gha-deploy` to one repository and branch through the `sub` claim. The account ID and the repository name are examples:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:photo-co/photo-app:ref:refs/heads/main"
      }
    }
  }]
}
```

The workflow asks GitHub for the token with `permissions: id-token: write` and passes the role's ARN as `role-to-assume` to the `aws-actions/configure-aws-credentials` action, which calls STS. IAM rejects a new or edited trust policy for GitHub's shared provider that doesn't test `sub`, and a loose pattern there, such as `repo:photo-co/*`, would still let workflows in other repositories assume the role.

**Test before you deploy.** The policy simulator evaluates a role's identity-based policies (and the SCPs in scope) against actions and resources, without making the calls:

```sh
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::111122223333:role/thumbnailer-role \
  --action-names s3:GetObject s3:DeleteObject \
  --resource-arns arn:aws:s3:::photos-prod/u/9f3c/IMG_0042.jpg \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
```

```text
s3:GetObject	allowed
s3:DeleteObject	implicitDeny
```

**Habits that keep it manageable:**

- Create roles and policies at deployment time, never on a request path, because of eventual consistency.
- Narrow with conditions: `aws:SecureTransport` as above, `aws:PrincipalOrgID` to keep a bucket inside the organization, `aws:SourceArn` or `aws:SourceAccount` wherever a resource-based policy trusts an AWS service principal.
- Give a team's pipeline a permissions boundary when it may create roles, so the roles it creates can't exceed the boundary.
- Keep people on Identity Center permission sets with short sessions, and keep the root user for root-only tasks, with MFA, or centralize root access across the organization.
- Review unused-access findings regularly and delete what nobody uses.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Policy-Based Authorization](../policy-based-authorization/) — Services ask a central policy engine for allow/deny decisions (RBAC, ABAC, ReBAC).
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [Token Exchange (On-Behalf-Of)](../token-exchange/) — Swap an incoming user token for a narrowly scoped one before calling a downstream API.
- [Valet Key](../valet-key/) — Give clients a short-lived, narrowly scoped URL to read or write storage directly.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Amazon Cognito](../amazon-cognito/) — Sign-up and sign-in for your app's users: user pools issue OpenID Connect tokens, identity pools trade them for AWS credentials.

## References

- [AWS IAM User Guide — What is IAM?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
- [AWS IAM User Guide — Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [AWS IAM User Guide — How AWS enforcement code logic evaluates requests to allow or deny access](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)
- [AWS IAM User Guide — Cross-account policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)
- [AWS IAM User Guide — Policies and permissions in AWS Identity and Access Management](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html)
- [AWS IAM User Guide — IAM JSON policy element reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)
- [AWS IAM User Guide — IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [AWS IAM User Guide — Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [AWS IAM User Guide — IAM identifiers (unique ID prefixes)](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html)
- [AWS IAM User Guide — AWS Signature Version 4 for API requests](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html)
- [AWS IAM User Guide — Create a signed AWS API request](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html)
- [AWS IAM User Guide — IAM and AWS STS quotas](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)
- [AWS IAM User Guide — Troubleshoot IAM: changes that I make are not always immediately visible](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html#troubleshoot_general_eventual-consistency)
- [AWS IAM User Guide — Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS IAM User Guide — AWS account root user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)
- [AWS IAM User Guide — Centralize root access for member accounts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-enable-root-access.html)
- [AWS IAM User Guide — AWS Multi-factor authentication in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html)
- [AWS IAM User Guide — Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)
- [AWS IAM User Guide — Access to AWS accounts owned by third parties](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html)
- [AWS IAM User Guide — The confused deputy problem](https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html)
- [AWS IAM User Guide — Create an OpenID Connect (OIDC) identity provider in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [AWS IAM User Guide — Identity-provider controls for shared OIDC providers](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc_secure-by-default.html)
- [AWS IAM User Guide — Define permissions based on attributes with ABAC authorization](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html)
- [AWS IAM User Guide — Revoke IAM role temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_revoke-sessions.html)
- [AWS IAM User Guide — Using AWS Identity and Access Management Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html)
- [AWS IAM User Guide — IAM Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html)
- [AWS IAM User Guide — IAM policy testing with the IAM policy simulator](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
- [AWS STS API Reference — AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)
- [AWS STS API Reference — AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)
- [AWS Organizations User Guide — Service control policies (SCPs)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [AWS Organizations User Guide — Resource control policies (RCPs)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html)
- [AWS Organizations User Guide — Quotas and service limits for AWS Organizations](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html)
- [AWS What's New — Introducing resource control policies (RCPs) (November 2024)](https://aws.amazon.com/about-aws/whats-new/2024/11/resource-control-policies-restrict-access-aws-resources/)
- [AWS IAM Identity Center User Guide — What is IAM Identity Center?](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [AWS IAM Identity Center User Guide — Manage AWS accounts with permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html)
- [AWS IAM Identity Center User Guide — Set session duration for AWS accounts](https://docs.aws.amazon.com/singlesignon/latest/userguide/howtosessionduration.html)
- [AWS Lambda — Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [AWS Lambda — Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
- [Amazon S3 User Guide — Examples of Amazon S3 bucket policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html)
- [Amazon S3 User Guide — Troubleshoot access denied (403 Forbidden) errors in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshoot-403-errors.html)
- [Amazon S3 User Guide — Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [AWS CloudTrail User Guide — Working with CloudTrail event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html)
- [AWS CloudTrail User Guide — Logging data events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html)
- [IAM Access Analyzer pricing](https://aws.amazon.com/iam/access-analyzer/pricing/)
- [IAM Roles Anywhere User Guide — What is IAM Roles Anywhere?](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html)
- [GitHub Docs — Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [Microsoft Learn — What is Azure role-based access control (Azure RBAC)?](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview)
- [Microsoft Learn — List Azure deny assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/deny-assignments)
- [Microsoft Learn — Workload identity federation (Microsoft Entra Workload ID)](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [Google Cloud — IAM overview](https://docs.cloud.google.com/iam/docs/overview)
- [Google Cloud — Deny policies](https://docs.cloud.google.com/iam/docs/deny-overview)
- [Google Cloud — Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
