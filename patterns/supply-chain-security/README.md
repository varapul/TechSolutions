
<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏗️ Platform Engineering](../../README.md#platform-engineering)

# Supply Chain Security (SLSA)

> Prove that what you deploy was built from your source: build provenance, SBOMs, signatures and a check before every deploy.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Supply Chain Security (SLSA)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/supply-chain-security.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · An unguarded supply chain** | Before: the checkout image is built on `build-01`, a Jenkins VM that 23 people can log in to, and the cluster runs whatever `checkout:latest` points to. The red letters mark where attacks strike, named as in the SLSA v1.2 threat model: **E** a tampered build, **H** a typosquatted package (`lodahs` instead of `lodash`), **F** an image re-pushed under the same tag from a laptop. Nobody keeps a list of what is inside an image, so when a critical CVE in a popular library is announced, finding which of the 38 services ship it takes four days. |
| **2 · Provenance and SBOMs** | The release workflow runs on a GitHub-hosted runner: a fresh VM for every job, with no logins and nothing left behind. It records **provenance**, an in-toto statement with the SLSA provenance predicate that names the image digest, the builder, the source commit `4e7a1c` and the workflow, signed through Sigstore, and Syft lists the image's 1,214 components in an **SBOM** (CycloneDX here; SPDX is the other common format). Both are stored in ECR next to the image, keyed by its digest `sha256:9f2c41…`. |
| **3 · Sign and verify** | The job signs the digest with **cosign** and no stored key: its GitHub Actions OIDC token is exchanged for a Fulcio certificate that names the workflow and is valid for 10 minutes, and the signature is recorded in the Rekor transparency log. At deploy time the Sigstore policy-controller admits the image only if it was signed by `release.yml` on `main` of `acme/checkout` and its provenance shows the expected builder, repository and branch; the pod runs the verified digest. An image built and pushed from a laptop carries no such signature and is rejected. |
| **4 · Roadmap, payoff, limits** | SLSA v1.2's Build levels make a roadmap: L1 provenance exists, L2 a hosted platform signs it (Acme today), L3 isolates every run and keeps signing secrets out of the build's reach. When the next critical CVE lands, Dependency-Track checks the stored SBOMs and lists the 3 affected services in 6 minutes instead of 4 days (Acme's numbers). The limits, in amber: provenance shows where and how an image was built, not that its code or its build was sound; SBOMs help only when someone queries them; a policy left in audit mode verifies nothing; and the dependencies' own supply chains are not Acme's to control. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's checkout team reviews every pull request, yet nothing proves that the image running in production was built from that reviewed code. The image comes off `build-01`, a Jenkins VM that has run since 2019, is patched by hand and lets 23 people log in; now and then someone builds on a laptop instead. Packages come straight from the public npm registry, so a one-letter slip (`lodahs` for `lodash`) installs whatever an attacker published under that name. The cluster deploys `checkout:latest`, a tag that anyone with push rights can move to another image. And nobody keeps a list of what is inside each image: when a critical vulnerability in a popular library was announced, it took four days of searching repositories, asking nine teams and opening shells in running pods to find which of the 38 services shipped it, and two images still couldn't be traced to any repository. (Acme's numbers on this page are the example's own, not research findings.)

Every one of these gaps has been used in real attacks:

- **The build.** In the SolarWinds compromise, disclosed in December 2020, the backdoor went in during the build. CrowdStrike's analysis of the implant, SUNSPOT (January 2021), describes a program on a build server that waited for builds of the Orion product and swapped one source file while it compiled, so that the shipped updates carried the SUNBURST backdoor.
- **Artifacts changed after the build.** From 31 January 2021 an attacker repeatedly altered Codecov's Bash Uploader script, using a credential extracted through an error in Codecov's Docker image creation process; for about two months, the script sent the environment variables of its users' CI jobs to the attacker (Codecov's security update, April 2021).
- **Dependencies.** The xz utils backdoor (CVE-2024-3094), which Andres Freund reported on 29 March 2024, sat in the upstream release tarballs of versions 5.6.0 and 5.6.1. Part of it existed only in those tarballs, not in the Git repository, while its payload hid in test files that were in the repository. SLSA's own list of real-world examples adds typosquatting (a malicious package with a name like a popular one) and the event-stream case, where an attacker who controlled a harmless-looking dependency published a malicious version that matched no change in its source code.
- **Missing inventories.** Log4Shell (CVE-2021-44228), exploited widely from December 2021, sent organisations hunting for every copy of the log4j-core library in versions 2.0-beta9 to 2.14.1, often buried inside other software.

Software supply chain security closes these gaps by making every artifact carry verifiable evidence of where it came from and what is in it, and by checking that evidence before anything runs.

## How it works

**SLSA** (Supply-chain Levels for Software Artifacts, pronounced "salsa") is a framework from the Open Source Security Foundation (OpenSSF): a set of requirements that can be adopted one level at a time. Version 1.2, released on 24 November 2025, organises them into two **tracks**, each with **levels**:

- The **Build track** (L0 to L3) is about how an artifact was produced and how far its provenance can be trusted.
- The **Source track** (L1 to L4), new in version 1.2, is about how a source revision was produced: L1 version control, L2 a continuous, retained history with source provenance, L3 technical controls that the source control system enforces on protected branches, L4 two-party review of every change.

SLSA's threat model names where attacks strike, and the diagram uses its letters. Source threats: (A) a malicious producer, (B) changing the source outside the agreed process, (C) compromising the source control system. Build threats: (D) building from the wrong source, branch or parameters, (E) tampering with the build process, (F) publishing an artifact that wasn't built from the official source, (G) replacing it in the distribution channel. Usage threats: (H) choosing the wrong package, through typosquatting or dependency confusion, and (I) using it unsafely. On top come dependency threats (all of the above, one level down), availability threats and verification threats. SLSA's real-world examples map SolarWinds to (E), Codecov to (F) and typosquatting to (H).

Four mechanisms answer most of these threats.

**1. Provenance.** A build platform records which artifact it built (by digest), which builder ran, from which source revision and with which top-level parameters. SLSA recommends its own format, an **in-toto attestation**: a *statement* binds the *subject* (here `checkout@sha256:9f2c41…`) to a *predicate* of type `https://slsa.dev/provenance/v1`, which holds a `buildDefinition` (the build type, the external parameters such as the repository, ref and workflow, and the resolved dependencies) and `runDetails` (the builder's ID and metadata about the run). An *envelope*, recommended in the DSSE format, carries the signature. The in-toto attestation framework, a CNCF project, defines these layers, and the same envelope carries other predicates too: SBOMs, test results, vulnerability scans.

The Build levels of SLSA v1.2 say how far the provenance can be trusted:

| Level | What the build needs | What it protects against |
|---|---|---|
| **L0** | nothing | nothing |
| **L1** | a consistent build process; the platform generates provenance | mistakes during a release; no protection against tampering, since unsigned provenance is easy to forge |
| **L2** | a hosted build platform that generates and signs the provenance | tampering after the build |
| **L3** | a hardened platform: builds isolated from one another, a fresh environment for every build, no cache one build can poison for another, and signing secrets out of reach of the build's own steps | tampering during the build, including by insiders and with stolen credentials |

**2. SBOM.** A software bill of materials lists the components of an artifact: names, versions, package URLs (purls), licences and how they depend on one another. Two formats dominate. **SPDX**, a Linux Foundation project, is an international standard (ISO/IEC 5962:2021) and is at version 3.0. **CycloneDX**, an OWASP project, is standardised by Ecma International as ECMA-424 and is at version 1.7. Tools such as Syft, Trivy or `docker buildx build --sbom=true` generate one from an image. An SBOM is an inventory, not a verdict: it pays off when something queries it, such as a scanner (Grype and Trivy both scan SBOMs) or a platform such as OWASP Dependency-Track, which tracks the components of every application in its portfolio and flags the ones affected by newly known vulnerabilities.

**3. Signing without stored keys.** Sigstore's **cosign** creates a key pair in memory, exchanges the CI job's OpenID Connect token for a certificate from **Fulcio**, Sigstore's certificate authority, signs the image digest, and records the signature in **Rekor**, a transparency log. Fulcio's certificates are valid for 10 minutes, and the private key never touches disk, so there is no long-lived key to steal. For CI workloads, the certificate names the workflow that signed, the repository, the ref and commit, and whether the runner was platform-hosted or self-hosted. A verifier checks that identity and the token's issuer, for example `cosign verify --certificate-identity https://github.com/acme/checkout/.github/workflows/release.yml@refs/heads/main --certificate-oidc-issuer https://token.actions.githubusercontent.com`. GitHub's artifact attestations (the `actions/attest` action) build on the same pieces: they create signed SLSA provenance, and SBOM attestations from SPDX or CycloneDX files. GitHub documents that they meet SLSA v1.0 Build L2 on their own, and Build L3 when the build runs in a reusable workflow that isolates it from the calling workflow.

**4. Verification before deploy.** None of this protects anything until someone checks it. SLSA's procedure for verifying artifacts (v1.2) has two main steps: confirm that the provenance is signed by a builder you trust, at the level you trust it for, and that its subject matches the artifact's digest; then compare it with your expectations, such as the build type, the repository, the branch and the workflow, and reject anything you don't recognise. An optional third step repeats the check for the artifact's dependencies. On Kubernetes, an admission controller makes this check for every pod: Kyverno with its `verifyImages` rules (or its newer ImageValidatingPolicy type), or the Sigstore **policy-controller** with a `ClusterImagePolicy`. Both make sure the verified image is the one that runs: Kyverno's `mutateDigest` setting, on by default, adds the digest to an image reference that names only a tag, and the policy-controller resolves tags to digests at admission.

**Related frameworks.** NIST's *Secure Software Development Framework* (SSDF, SP 800-218, version 1.1, February 2022) sorts secure development practices into four groups: prepare the organisation, protect the software, produce well-secured software, and respond to vulnerabilities. Its *Protect the Software* group matches this page closely: protect all forms of code from tampering (PS.1), give the people who acquire your software a way to verify release integrity (PS.2), and archive each release with the provenance data of all its components, an SBOM for example (PS.3.2). NIST published an initial public draft of Revision 1 (SSDF version 1.2) in December 2025. For open-source dependencies, the **OpenSSF Scorecard** rates projects with automated checks such as Pinned-Dependencies, Signed-Releases, Code-Review, Branch-Protection, Dangerous-Workflow and Maintained, each scored from 0 to 10.

## Putting it into practice

1. **Start with the inventory.** Generate an SBOM for every image in the pipeline (Syft, Trivy or BuildKit), attach it to the image digest, and send it to an index that watches for new advisories (Dependency-Track, for example). This alone turns Acme's four-day hunt into a query: when the next critical CVE was published at 09:00, the index listed the three affected services, checkout, search and delivery, at 09:06.
2. **Build on a hosted, ephemeral platform.** GitHub-hosted runners provision a new VM for each job and decommission it when the job ends; hosted GitLab runners, Google Cloud Build and AWS CodeBuild are alternatives. Remove interactive logins to build machines, and build releases only from reviewed commits on a protected branch.
3. **Let the platform write the provenance:** GitHub's `actions/attest`, the SLSA GitHub generator, or BuildKit's provenance attestations (`docker buildx build --provenance=mode=max`). Store it next to the image. Acme reached Build L1 first, then L2 once the hosted platform signed the provenance.
4. **Sign the digest.** Use cosign's keyless signing from the release workflow, or a key held in a key management service (cosign accepts `awskms://`, `gcpkms://`, `azurekms://` and `hashivault://` key references) if you can't use the public Sigstore services.
5. **Deploy by digest and verify at admission.** Pin images by digest in the manifests (with GitOps, the pipeline opens a pull request that updates the digest), turn on tag immutability in the registry (Amazon ECR has a setting for it), and enforce a policy that names the expected signer identity, issuer, repository, branch and builder (Acme uses the Sigstore policy-controller and a `ClusterImagePolicy`). Run it in audit mode for a short, dated period, fix what it reports, then enforce, keeping a logged break-glass path for emergencies.
6. **Pin and vet dependencies.** Commit lockfiles with integrity hashes (npm's `package-lock.json` records one for every package), pin base images and CI actions by digest or commit SHA, let an update bot (Dependabot or Renovate) keep the pins current through small reviewed pull requests, look at a new dependency's Scorecard before adopting it, and consider a proxy registry that serves only approved packages.
7. **Raise the build to L3.** Move provenance generation and signing into a reusable workflow or a trusted builder that the build steps can't influence, keep caches separate between untrusted and release workflows, and grant the permission to request an identity token (`id-token: write` on GitHub) only to the job that signs.
8. **Protect the source.** Use branch protection and required reviews. Source L4 asks that two trusted people, for example the author and a reviewer, agree to every change on a protected branch, and that reviews cover the security-relevant parts of the code.
9. **Measure it:** the share of production images with provenance and an SBOM, the share of admissions enforced rather than only audited, the number and age of policy exceptions, and the time to answer "which images contain this library?".

## Where it fits

- [Continuous Delivery](../continuous-delivery/) builds an image once and promotes the same digest through every stage; supply chain security proves where that digest came from and checks it before each deploy.
- [Immutable Infrastructure](../immutable-infrastructure/) replaces images instead of patching them, which is what makes a digest a stable thing to sign and verify.
- [GitOps](../gitops/) keeps the digests in Git: a reviewed pull request changes them, the agent applies them, and the admission policy verifies them on the way into the cluster.
- [Docker](../docker/) produces the images, layers and digests, and BuildKit can attach provenance and SBOM attestations to them.
- [Kubernetes](../kubernetes/) admission control is where the deploy-time check runs.
- [Policy as Code](../policy-as-code/) covers how rules like the admission policy are written, tested and rolled out; this page is about the evidence those rules check.
- [Zero Trust Access](../zero-trust-access/) applies the same idea to requests: trust nothing because of where it comes from, verify it explicitly. Here, an image isn't trusted because it sits in the company registry.
- [Vault](../vault/) or a cloud key management service holds the signing keys when keyless signing isn't an option, so that no key lives on a build machine.
- [Golden Paths](../golden-paths/) make it the default: a paved-road pipeline template that already generates SBOMs and provenance and signs every image.

## When to use it

It pays off for any team that ships containers or packages to production and depends on open source, which is nearly every team. It pays off most for a shared platform, where one hosted builder and one admission policy cover every service, for regulated environments that must show where their software came from (SSDF practices, customer security questionnaires), and for open-source producers, whose users can verify provenance before installing.

Adapt it to the context:

- **Small teams** get most of the value from hosted CI, GitHub's attestations or BuildKit's, an SBOM scan in CI and one admission policy; Build L3 and the Source track can come later.
- **Private code and the public log.** GitHub notes that attestations from public repositories go to the public Sigstore instance, whose transparency log anyone can read, while private repositories use GitHub's own Sigstore instance, which has no transparency log. Decide whether repository and workflow names may appear in a public log; if not, use a private instance or keys held in a key management service.
- **Legacy and VM-based software** can start with SBOMs and published checksums; provenance and admission control follow with containers.

It costs more than it returns for throwaway prototypes and for builds that only feed automated tests: GitHub advises against signing such frequent test builds. And it doesn't replace review, testing or vulnerability management: it makes them traceable.

## Common pitfalls

- **SBOMs generated, never read.** Files in a registry answer nothing on their own. Index them, alert on new advisories, and rehearse the question "which images contain this library?" before an incident asks it.
- **Signatures nobody verifies.** GitHub's documentation puts it plainly: attestations bring no security benefit until someone verifies them. Enforce at admission; run audit mode only as a dated transition, since a policy that only logs blocks nothing.
- **Checking "is it signed?" instead of "signed by whom?".** Anyone can obtain a valid keyless signature for their own identity. Pin the exact signer (the workflow path and ref) and the issuer, and check the builder and source in the provenance.
- **Taking provenance as proof of safety.** Provenance records where and how an artifact was built, not whether its code is good: the xz payload was in the repository's own test files. Nor does it prove, at Build L2, that the build itself was clean. On 11 May 2026 attackers published 84 malicious versions of 42 `@tanstack` npm packages with valid provenance: a pull request had poisoned the build cache, and code from that cache read the release workflow's identity token from the runner's memory (SLSA blog, May 2026). Keep review, tests and scanning; move towards Build L3 isolation; and alert on releases from failed or unusual workflow runs.
- **Verifying a tag and pulling it later.** A tag can move between the check and the pull. Verify the digest, and run the digest.
- **Exceptions that never expire, and policies nobody reviews.** SLSA lists tampering with the verifier's expectations as a threat of its own. Review policy changes like code, and give every exception an owner and an end date.
- **Forgetting the dependencies' own supply chains.** SLSA v1.2 doesn't yet address dependency threats directly; its advice is to apply SLSA recursively. Prefer packages that publish provenance, pin versions and hashes, vet new dependencies with Scorecard, and mirror what you use.
- **Expecting provenance to stop typosquats.** SLSA doesn't address typosquatting. Review lockfile changes, allow-list packages, or serve them through a curated proxy registry.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Policy as Code](../policy-as-code/) — Write rules as code and check them automatically in CI and at deploy time, so guardrails replace manual approval gates.
- [Continuous Delivery](../continuous-delivery/) — Keep every change releasable: a deployment pipeline builds once, tests in stages and promotes the same artifact to production.
- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.
- [Docker & Containers](../docker/) — Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.
- [HashiCorp Vault](../vault/) — A secrets manager: authenticate workloads, hand out short-lived credentials, encrypt data and audit every access.

## References

- [SLSA — Specification v1.2](https://slsa.dev/spec/v1.2/)
- [SLSA blog — Announcing SLSA v1.2 (24 November 2025)](https://slsa.dev/blog/2025/11/announce-slsa-v1.2)
- [SLSA v1.2 — Build: Track Basics (levels)](https://slsa.dev/spec/v1.2/build-track-basics)
- [SLSA v1.2 — Build: requirements for producing artifacts](https://slsa.dev/spec/v1.2/build-requirements)
- [SLSA v1.2 — Source: requirements for producing source](https://slsa.dev/spec/v1.2/source-requirements)
- [SLSA v1.2 — Supply chain threats, with real-world examples](https://slsa.dev/spec/v1.2/threats-overview)
- [SLSA v1.2 — Threats and mitigations](https://slsa.dev/spec/v1.2/threats)
- [SLSA v1.2 — Build provenance](https://slsa.dev/spec/v1.2/build-provenance)
- [SLSA v1.2 — Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts)
- [SLSA blog — Mini Shai-Hulud: Where SLSA's Boundaries Fall (May 2026)](https://slsa.dev/blog/2026/05/mini-shai-hulud-what-slsa-can-and-cannot-do)
- [in-toto — Attestation Framework](https://github.com/in-toto/attestation)
- [Sigstore — Fulcio, the certificate authority](https://docs.sigstore.dev/certificate_authority/overview/)
- [Sigstore — Security model](https://docs.sigstore.dev/about/security/)
- [Sigstore — Verifying signatures with cosign](https://docs.sigstore.dev/cosign/verifying/verify/)
- [Sigstore — Fulcio certificate extensions (OID information)](https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md)
- [Sigstore — Key management overview (cosign)](https://docs.sigstore.dev/cosign/key_management/overview/)
- [Sigstore — Kubernetes policy-controller](https://docs.sigstore.dev/policy-controller/overview/)
- [Kyverno — Verify images: overview](https://kyverno.io/docs/policy-types/cluster-policy/verify-images/overview/)
- [Kyverno — ImageValidatingPolicy](https://kyverno.io/docs/policy-types/image-validating-policy/)
- [GitHub Docs — Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub Docs — Using artifact attestations to establish provenance for builds](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub Docs — Using GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners)
- [SPDX — Specifications (ISO/IEC 5962:2021)](https://spdx.dev/use/specifications/)
- [CycloneDX — Specification overview (ECMA-424)](https://cyclonedx.org/specification/overview/)
- [OWASP Dependency-Track](https://github.com/DependencyTrack/dependency-track)
- [Docker Docs — Build attestations (provenance and SBOM)](https://docs.docker.com/build/metadata/attestations/)
- [NIST SP 800-218 — Secure Software Development Framework (SSDF) Version 1.1 (February 2022)](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST SP 800-218 Rev. 1 — SSDF Version 1.2, initial public draft (December 2025)](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [CrowdStrike — SUNSPOT Malware: A Technical Analysis (January 2021)](https://www.crowdstrike.com/en-us/blog/sunspot-malware-technical-analysis/)
- [Codecov — Bash Uploader Security Update (April 2021)](https://about.codecov.io/security-update/)
- [Andres Freund — backdoor in upstream xz/liblzma (oss-security, 29 March 2024)](https://www.openwall.com/lists/oss-security/2024/03/29/4)
- [CISA — Apache Log4j Vulnerability Guidance](https://www.cisa.gov/news-events/news/apache-log4j-vulnerability-guidance)
- [Kubernetes documentation — Images (tags and digests)](https://kubernetes.io/docs/concepts/containers/images/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
