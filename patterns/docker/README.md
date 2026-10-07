<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🧱 System Components](../../README.md#system-components)

# Docker & Containers

> Package an app and its dependencies as an image and run it as an isolated process: layers, registries, namespaces, cgroups.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Docker &amp; Containers" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/docker.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Where it sits** | Acme Shop's CI builds the Catalog service's image **catalog:1.4.2** once and pushes it to Amazon ECR, where the tag points to a manifest digest, `sha256:9f2c…`. A developer's laptop (Docker Desktop), staging (Amazon ECS) and production (Kubernetes on Amazon EKS) all pull that **digest**, so the image that passed the tests in staging is, byte for byte, the one that runs in production. The image carries the service and everything it needs above the kernel: a Debian userland, Node.js 24, its npm dependencies and its compiled code. |
| **2 · Layers and the cache** | Each `RUN`, `COPY` or `ADD` instruction saves its file changes as a read-only **layer**, named by a hash of its content. Only `src/price.ts` changed, so BuildKit re-runs `COPY . .`, the build and the `COPY` that takes its output, takes every other step from its **cache**, and the image gets one new layer; the `node:24` build stages, with TypeScript and the dev dependencies, never reach it, because the last stage starts `FROM node:24-slim` and copies in only what it needs. Push and pull compare digests, so ECR and host-1 receive just that one layer. |
| **3 · Running a container** | `docker run` goes to **dockerd**, which asks **containerd** to create the container; containerd has **runc** start `node` as PID 1 in new pid, net, mnt, uts, ipc and cgroup **namespaces**, so it gets its own process tree, network interface, mounts and hostname. A **cgroup** caps it at 0.5 CPU (`cpu.max` 50000 100000) and 512 MiB (`memory.max`). Each container adds only a thin **writable layer** (copy-on-write) on top of the image layers, which both containers share, and both run on host-1's one kernel. |
| **4 · Limits and trade-offs** | When catalog-2 reaches its 512 MiB limit, the kernel's OOM killer sends it SIGKILL: `docker inspect` reports `OOMKilled` and exit code **137** (128 + 9). Its writable layer is deleted when the container is removed, so state belongs in volumes or in a database. Every container shares the host's kernel, so isolation is weaker than a virtual machine's: run as non-root, drop capabilities, keep the root filesystem read-only, and scan, sign and pin images by digest. |
<!-- END GENERATED: header -->

## The problem

Acme Shop's Catalog service is a Node.js application written in TypeScript. To run it, a machine needs a particular Node.js release, the exact npm packages in its lockfile, a few system libraries and the compiled JavaScript. When each environment is prepared by hand or by its own scripts, they drift apart: the laptop has another Node.js version, staging got an operating-system patch that production hasn't, and a native package that builds on one machine fails on the next. Every deploy installs everything again, so what runs in production is not quite what was tested. Giving each service its own virtual machine removes the conflicts, but costs a whole operating system per service, and machine images are slow to build and to boot.

A **container image** packages the service with everything it needs above the kernel: a Linux distribution's userland, the runtime, the dependencies and the code. CI builds it once, and every environment runs the same bytes, identified by a digest. A running **container** is an ordinary Linux process that the kernel isolates with namespaces and limits with cgroups, so nothing has to boot. Docker made this way of working common, and in 2015 it gave its image format and its runtime, runc, to the newly founded Open Container Initiative (OCI), whose specifications the other tools now follow too.

## How it works

### An image is layers, a config and a manifest

An image is made of three kinds of object, each stored as a blob and named by the SHA-256 digest of its bytes:

- **Layers.** A layer is a tar archive of filesystem changes: files added or changed, and deletions recorded as *whiteout* entries. Unpacked in order, the layers form the container's root filesystem.
- **The config.** A JSON document with the defaults for running the image (command, environment, working directory, user) and the DiffIDs of its layers, the digests of the uncompressed archives.
- **The manifest.** A JSON document that lists the config and the layers by digest. Its own digest therefore stands for the whole image: change one byte in any layer and the manifest's digest changes too. A multi-platform image adds an **image index** that points to one manifest per platform, and BuildKit also uses an index to attach its attestations.

Only instructions that change files create layers: `RUN`, `COPY` and `ADD`. `USER`, `CMD`, `ENV` and the others change only the config. The Catalog image has seven layers. Its base, `node:24-slim`, brings five: a Debian 12 root filesystem, then one layer each for a `node` user, Node.js, Yarn and an entrypoint script (the diagram draws those four as one bar, marked +3). The Dockerfile adds two: the production dependencies and the compiled app.

A **tag** such as `catalog:1.4.2` is a name in a repository that points to a manifest or an index, and it can be moved. A **digest** such as `sha256:9f2c…` can't. Deploying by digest is how the laptop, staging and production in step 1 know they run the same bytes.

### Building: the Dockerfile, stages and the cache

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24 AS deps
WORKDIR /src
COPY package*.json ./
RUN npm ci --omit=dev

FROM deps AS build
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
COPY --from=deps /src/node_modules /app/node_modules
COPY --from=build /src/dist /app/dist
USER node
CMD ["node", "/app/dist/server.js"]
```

The first two **stages** start from the full `node:24` image, which has compilers and build tools: `deps` installs only the production dependencies, and `build` adds the dev dependencies (TypeScript among them) and compiles `src/` into `dist/`. The last stage starts again from the much smaller `node:24-slim` and copies in just the two directories it needs, so neither the compilers nor the dev dependencies reach the image that ships. BuildKit, the default builder in Docker Desktop and Docker Engine, builds only the stages the target depends on and runs independent stages in parallel.

Every step's result is **cached**. For `COPY` and `ADD`, the builder computes a checksum of the files being copied (their modification times don't count); for `RUN` it compares only the command string, so the builder never notices that a package registry now serves something newer. Once a step misses, every later step in that stage runs again. That is why the Dockerfile copies the package files and installs dependencies before it copies the source. In step 2 only `src/price.ts` changed, so `COPY . .`, `npm run build` and the final `COPY --from=build` ran again, everything else came from the cache, and 1.4.2 differs from 1.4.1 by one layer.

`docker buildx build --push` sends the result straight to the registry. A CI runner that starts empty every time has no cache to reuse; export it with `--cache-to` and read it back with `--cache-from` (there are registry, GitHub Actions, [S3](../amazon-s3/) and local backends). BuildKit also attaches a minimal provenance attestation to the image by default, and an SBOM when asked with `--sbom=true`.

### Registries: push, pull, tags and digests

Registries implement the OCI Distribution Specification. To push, the client first asks whether the registry already has each blob, with a `HEAD` request per digest, and uploads only the missing ones; a blob that already sits in another repository of the same registry can be *mounted* instead of uploaded. Then it uploads the manifest and points the tag at it. A pull runs the other way: fetch the manifest by tag or by digest, then download only the layers the host doesn't have (Docker Engine downloads three layers at a time and uploads five at a time by default). In step 2, ECR already had the other six layers and host-1 already had them from 1.4.1, so each transfer moved a single layer.

**Amazon ECR** keeps private repositories per account and Region. Clients authenticate through [IAM](../aws-iam/): `aws ecr get-login-password` returns a token for `docker login` that is valid for 12 hours. A repository can make its tags **immutable** (pushing a tag that exists then fails with `ImageTagAlreadyExistsException`), with optional exclusions. ECR scans images with **basic scanning** (operating-system vulnerabilities) or **enhanced scanning** through Amazon Inspector (operating-system and language packages, on push and continuously); lifecycle policies expire old images; pull-through cache rules mirror upstream registries such as Docker Hub, with the credentials kept in AWS Secrets Manager; and managed signing with AWS Signer signs images automatically.

**Docker Hub** limits pulls. As of October 2026, unauthenticated clients get 100 pulls per 6 hours, counted per IPv4 address or IPv6 /64 subnet; a free Personal account gets 200 per 6 hours; Pro, Team and Business accounts are unlimited, subject to fair use. A pull is one manifest download, a multi-architecture image counts once per architecture, and `HEAD` checks don't count. CI runners behind one NAT address share the unauthenticated quota, so log in, or mirror the base images, for example through an ECR pull-through cache.

### Running: Docker Engine, containerd and runc

`docker run` is a client call. The CLI sends it to **dockerd**, the Docker Engine daemon, which leaves creating, starting and stopping containers to **containerd**. containerd runs each container through a shim that calls **runc**, its default runtime, the one Docker gave to the OCI. runc reads the container's bundle, a root filesystem plus a `config.json` that lists the namespaces, cgroup limits, mounts, capabilities and seccomp filter, sets all of it up, and starts `node` as the container's first process. Since Engine 29.0, fresh installs also keep images in containerd's image store, which uses containerd's snapshotters instead of Docker's older storage drivers.

On a Kubernetes node there is no dockerd: the kubelet talks to containerd or CRI-O through the **Container Runtime Interface** (CRI). Kubernetes removed its built-in Docker integration, dockershim, in version 1.24 (May 2022). Images built with `docker build` run unchanged under every CRI runtime, because they are OCI images, and Docker Engine itself can still serve a cluster through the cri-dockerd adapter.

The OCI publishes the three standards underneath (as of October 2026): the Image Format Specification v1.1.1 (March 2025), the Runtime Specification v1.3.0 (November 2025) and the Distribution Specification v1.1.1 (January 2025). The current releases of the stack are Docker Engine 29.8.2 (30 September 2026), containerd 2.4 and runc 1.5.

### Namespaces: what a container can see

Linux has eight kinds of namespace: cgroup, IPC, network, mount, PID, time, user and UTS. Docker gives each container new **pid**, **net**, **mnt**, **uts** and **ipc** namespaces, and on cgroup v2 hosts a private **cgroup** namespace, which is dockerd's default. So `node` is PID 1 and sees only its own processes; it has its own network interface, connected to a bridge on the host; its own mount table, rooted in the image layers; and its own hostname, the container's ID unless you choose one. A **user** namespace is not used by default (see the security section below).

Being PID 1 has a catch: the kernel delivers a signal to a namespace's first process only if that process has installed a handler for it, and SIGKILL is the exception. `docker stop` sends SIGTERM and, after a grace period, SIGKILL, so a Node.js app that doesn't handle SIGTERM ignores it and is killed at the end of the grace period instead of shutting down cleanly. Handle the signal in the app, or start the container with `--init`, which adds a small init process that forwards signals and reaps child processes.

### cgroups: what a container can use

The command in step 3 sets limits that runc writes into the container's cgroup (version 2):

- `--cpus=0.5` is a CFS bandwidth quota of 50,000 µs in every 100,000 µs period, written to `cpu.max` as `50000 100000`. A container that wants more is **throttled** until the next period; it isn't killed.
- `--memory=512m` becomes `memory.max` (536870912 bytes). When the cgroup's usage reaches it and the kernel can't reclaim enough, the **OOM killer** chooses a process in that cgroup and sends it SIGKILL. When that is the container's main process, the container exits with code 137 (128 + 9, SIGKILL's signal number) and `docker inspect` shows `OOMKilled: true`.
- `--memory-swap=512m`, the same value as `--memory`, keeps the container off swap. Left unset, a container may use as much swap as its memory limit on a host that has swap.

`--pids-limit` caps the number of processes too. Docker Engine 29.0 deprecated cgroup v1; Docker supports it until at least May 2029.

### Storage and networks

The image layers are read-only and shared: both containers in step 3 use the same copy on disk. Each container adds one thin **writable layer** on top. With the overlay2 driver, the first write to a file from an image layer copies the whole file up into the writable layer (*copy-on-write*), and a deletion is recorded as a whiteout. Heavy writes are therefore slow, and the writable layer is deleted together with the container. Put data that must outlive the container in a **volume**, whose contents exist outside any container's lifecycle; use a **tmpfs** mount for scratch space; and add `--read-only` to make the root filesystem read-only altogether. For a service like Catalog, the state belongs outside the host anyway, in a database or an object store.

Each container's network namespace has its own interface. Unless told otherwise, Docker attaches it to the default `bridge` network, where containers reach each other only by IP address; on a user-defined bridge network (`docker network create`) they also find each other by name through Docker's built-in DNS. Nothing in a container is reachable from outside the host until a port is published: `-p 8080:3000` maps port 8080 on the host to port 3000 in the container, through firewall rules that Docker writes on the host.

### Security: one kernel for all

Every container on a host shares its kernel, so the kernel is the isolation boundary. Docker's defaults narrow what a container may ask of it: a short default list of Linux capabilities instead of root's full set, and a seccomp profile that blocks around 44 of the more than 300 system calls. Hardening goes further: a non-root `USER` (here `node`), `--cap-drop=ALL` with only the capabilities the app needs added back, `--read-only`, and `--security-opt no-new-privileges`. **User namespaces** map root inside the container to an unprivileged user ID on the host: `userns-remap` does this for the containers while dockerd itself still runs as root, and **rootless mode** runs both the daemon and the containers without root. Where tenants don't trust each other, put a stronger boundary around the workload: gVisor intercepts the container's system calls and handles them itself, and Kata Containers runs containers inside lightweight virtual machines.

The image is software you ship, so its supply chain needs the same care as the code: generate an SBOM, scan on push and keep scanning, sign the digest, verify signatures before deploying, and pin base images by digest. Sigstore's `cosign` signs keylessly: it uses an ephemeral key and a certificate tied to the OIDC identity of the CI workflow, and records the signing in a public transparency log. Docker Content Trust, Docker's older signing feature, was removed from the Docker CLI in Engine 29.0.

## Where it fits

- **Solutions.** The unit of deployment for services on [Kubernetes](../kubernetes/) (Amazon EKS) and [Amazon ECS](../amazon-ecs/) (on EC2 instances or AWS Fargate); [AWS Lambda](../aws-lambda/) functions packaged as container images, up to 10 GB uncompressed, stored in Amazon ECR in the function's Region; CI pipelines that build, test and scan inside containers; and local development with Docker Desktop and Docker Compose, which runs a service next to its database and cache.
- **Patterns it implements or supports.** [Immutable infrastructure](../immutable-infrastructure/): a release is a new image, never a change to a running one. [Blue-green deployment](../blue-green-deployment/), [rolling updates](../rolling-update/) and [canary releases](../canary-release/) move traffic from one image digest to another, and [GitOps](../gitops/) keeps the digest each environment should run in Git. A [sidecar](../sidecar/) is a second container that shares the pod's network namespace with the app. cgroup limits give each container its own [bulkhead](../bulkhead/) on a shared host, and containers are the usual building block of [microservices](../microservices/).
- **Usual neighbours.** A CI system with a build cache; a registry such as Amazon ECR, Docker Hub, GitHub Container Registry or Harbor; image scanners and signers; an orchestrator; a secrets manager; and log and metrics agents that collect what the containers write to stdout and stderr.
- **Managed offerings.** Amazon ECR is AWS's registry, Amazon ECS, AWS Fargate and Amazon EKS run containers, and Lambda runs container images as functions. Docker Hub is Docker's own registry.
- **Licences.** Docker Engine (the Moby project), the Docker CLI, containerd and runc are open source under the Apache License 2.0. Docker Desktop is not: under the Docker Subscription Service Agreement it is free for small businesses (fewer than 250 employees and less than US$10 million in annual revenue), personal use, education and non-commercial open-source projects, and needs a paid Pro, Team or Business subscription for professional use in larger organizations and for government entities. The common alternatives are Apache 2.0 too: **Podman** (6.1 as of October 2026) runs the same images without a daemon, also rootless, with a Docker-compatible command line (`alias docker=podman` works for most uses), and has Podman Desktop for laptops; **Buildah** builds OCI images without a daemon.

## When to use it

Package a service as a container image when it has to run the same way on laptops, in CI and in several environments; when you deploy often and want a rollback to be a change of digest; when several services share hosts but need their own dependencies and resource limits; and when an orchestrator such as Kubernetes or Amazon ECS will run it. Don't treat a container on its own as the security boundary between workloads that don't trust each other: use virtual machines, microVMs or a sandboxed runtime. And for short, event-driven work a function can be simpler, because Lambda runs your image without hosts or a cluster to look after.

| | Virtual machine | Container | microVM (Firecracker) | Function (AWS Lambda) |
|---|---|---|---|---|
| Isolation boundary | A hypervisor; each VM runs its own kernel | Namespaces, cgroups, capabilities and seccomp on one shared kernel | A hypervisor (KVM) with a minimal device model; each microVM runs its own guest kernel | AWS's own: Lambda is built on Firecracker microVMs |
| What you ship | A machine image with a whole operating system | An OCI image: userland, runtime, dependencies and code | A guest kernel and a root filesystem | A .zip archive or an OCI image of up to 10 GB, plus a handler |
| Starting one | Boots an operating system | Starts a process; nothing boots | Boots a minimal guest kernel, in under 125 ms according to the project | A cold start creates an environment; later requests reuse it |
| Overhead per instance | A guest operating system and its memory | A process; the image layers are shared on disk | Under 5 MiB of memory per microVM, according to the project | Not visible: you pay per request and per GB-second |
| Where it runs | EC2 or your own hypervisor | Any Linux host; Amazon ECS, Amazon EKS, AWS Fargate | Inside platforms such as Lambda and Fargate, or on your own hosts with KVM | On AWS only |
| Choose it for | Other kernels or operating systems, strong isolation between tenants, legacy systems | Packaging and running services densely, with fast and repeatable deploys | Multi-tenant platforms that need VM isolation at close to container speed | Short event-driven work with nothing to run underneath |

Firecracker's figures come from the project's site, its use in Lambda and Fargate from the NSDI 2020 paper, and Lambda's image limit from its quotas page (October 2026).

## Trade-offs

- **The kernel is shared.** A kernel vulnerability, a privileged container or a careless mount (the Docker socket, which controls the daemon and so the host, is the classic one) can let a container reach its neighbours or the host. The defaults help; code you don't trust needs a VM-level boundary.
- **The filesystem is temporary.** Whatever is written outside a volume disappears with the container, and copy-on-write makes write-heavy work slow. State has to live in volumes or managed stores, which makes stateful services the hard part.
- **Images are software to maintain.** A base image carries a distribution's packages and their vulnerabilities, and tags such as `node:24-slim` are rebuilt as fixes appear, so the same Dockerfile gives a different image next month. Pinning the base by digest makes builds repeatable, and it also means updating the pin deliberately to get the fixes.
- **Limits cut both ways.** A tight CPU quota throttles bursts, because a container that has used its quota waits for the next 100 ms period, and a tight memory limit means OOM kills; loose limits waste the host. Size them from measurements.
- **The registry joins the critical path.** Every deploy and every scale-out pulls from it, so its availability, its rate limits (Docker Hub's especially) and the size of the images all matter.
- **More moving parts.** One container is simple; a hundred need an orchestrator, a registry, image policies, log collection and patching of the hosts. Docker Desktop also costs money in larger organizations.

## Implementation notes

- **Keep images small and specific.** Start from a slim or distroless base, use a multi-stage build, and add a `.dockerignore` (here `node_modules`, `dist`, `.git` and local `.env` files) so the build context stays small and secrets stay out of it.
- **Order the Dockerfile for the cache.** Copy what rarely changes, such as lockfiles, and install dependencies before copying the source that changes with every commit.
- **Never bake secrets into an image.** Build arguments and environment variables persist in the image. Pass build-time secrets with `docker buildx build --secret` and read them with `RUN --mount=type=secret`; give runtime secrets to the container from a secrets manager.
- **Run with limits and as little privilege as possible.** The image already sets `USER node`; the run below adds the step 3 limits, a read-only root filesystem with a tmpfs for `/tmp`, no capabilities and no privilege escalation. The `node` user can't write to `/app`, which is what you want.

```sh
ECR=111122223333.dkr.ecr.us-east-1.amazonaws.com
IMAGE=$ECR/catalog@sha256:9f2c…   # the full digest CI printed for 1.4.2

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ECR"
docker run -d --name catalog-1 \
  --cpus=0.5 --memory=512m --memory-swap=512m --pids-limit=256 \
  --read-only --tmpfs /tmp \
  --cap-drop=ALL --security-opt no-new-privileges \
  "$IMAGE"

# Why did catalog-2 stop?
docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' catalog-2
# true 137
```

- **Handle shutdown.** Catch SIGTERM in the app, stop taking new work, finish what is in flight and exit before the grace period ends, or add `--init`.
- **Log to stdout and stderr,** and let the engine or the orchestrator ship the logs; don't write log files into the writable layer.
- **Say the same thing to Kubernetes.** The container spec below gives Catalog the requests the scheduler uses and the same limits and hardening. With `runAsNonRoot` the kubelet refuses to start the container as UID 0, and `runAsUser: 1000` states the `node` user's UID explicitly.

```yaml
containers:
  - name: catalog
    image: 111122223333.dkr.ecr.us-east-1.amazonaws.com/catalog@sha256:9f2c…
    resources:
      requests: { cpu: 250m, memory: 256Mi }
      limits: { cpu: 500m, memory: 512Mi }
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: ["ALL"] }
```

- **Sign and verify the digest, not the tag.** `cosign sign "$IMAGE"` in the CI job signs keylessly with the job's OIDC identity; `cosign verify "$IMAGE" --certificate-identity=… --certificate-oidc-issuer=…` checks the signer before a deploy, and an admission controller such as Sigstore's Policy Controller can enforce the same check in a cluster.
- **Build for the processors you run on.** `docker buildx build --platform linux/amd64,linux/arm64` puts an image for x86 and one for Arm (such as AWS Graviton) behind one tag.
- **Clean up.** ECR lifecycle policies expire old and untagged images; on a host, `docker system prune` removes unused data.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Immutable Infrastructure](../immutable-infrastructure/) — Never patch servers in place: bake a new image and replace them.
- [Kubernetes](../kubernetes/) — A container orchestrator: you declare the desired state, and controllers keep pods scheduled, healthy and reachable.
- [Amazon ECS & Fargate](../amazon-ecs/) — Run containers on AWS: task definitions, services that keep tasks running behind a load balancer, on EC2 or serverless Fargate.
- [AWS Lambda](../aws-lambda/) — Functions as a service: code runs per event in managed execution environments that scale out with concurrency.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Rolling Update](../rolling-update/) — Replace instances batch by batch while the service stays up.
- [Blue-Green Deployment](../blue-green-deployment/) — Run the new version beside the old one and switch all traffic in one step.
- [GitOps](../gitops/) — Git holds the desired state; an agent continuously reconciles the cluster to match it.

## Related principles and frameworks

- [The Twelve-Factor App](../twelve-factor-app/) — Twelve rules for apps that deploy cleanly anywhere: config in the environment, stateless processes, separate build, release and run.
- [Supply Chain Security (SLSA)](../supply-chain-security/) — Prove that what you deploy was built from your source: build provenance, SBOMs, signatures and a check before every deploy.

## References

- [Docker Docs — Understanding the image layers](https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/)
- [Docker Docs — Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Docs — Build cache invalidation](https://docs.docker.com/build/cache/invalidation/)
- [Docker Docs — Building best practices](https://docs.docker.com/build/building/best-practices/)
- [Docker Docs — Storage drivers](https://docs.docker.com/engine/storage/drivers/)
- [Docker Docs — Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Docs — Docker Engine security](https://docs.docker.com/engine/security/)
- [Docker Docs — Docker Hub pull usage and limits](https://docs.docker.com/docker-hub/usage/pulls/)
- [Docker Docs — Docker Desktop license agreement](https://docs.docker.com/subscription-billing/desktop-license/)
- [Docker Docs — Docker Engine version 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- [Open Container Initiative — About the OCI](https://opencontainers.org/about/overview/)
- [OCI Image Format Specification — release v1.1.1 (March 2025)](https://github.com/opencontainers/image-spec/releases/tag/v1.1.1)
- [OCI Runtime Specification — release v1.3.0 (November 2025)](https://github.com/opencontainers/runtime-spec/releases/tag/v1.3.0)
- [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)
- [Linux manual page — namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [Linux manual page — cgroups(7)](https://man7.org/linux/man-pages/man7/cgroups.7.html)
- [Linux kernel documentation — Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [containerd — an industry-standard container runtime](https://containerd.io/)
- [Kubernetes — Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Kubernetes Blog — Updated: Dockershim Removal FAQ (2022)](https://kubernetes.io/blog/2022/02/17/dockershim-faq/)
- [Agache et al. — Firecracker: Lightweight Virtualization for Serverless Applications (NSDI 2020)](https://www.usenix.org/conference/nsdi20/presentation/agache)
- [Firecracker — project site](https://firecracker-microvm.github.io/)
- [Amazon ECR User Guide — Scan images for software vulnerabilities](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)
- [Sigstore — Signing containers with Cosign](https://docs.sigstore.dev/cosign/signing/signing_with_containers/)
- [Podman documentation — What is Podman?](https://docs.podman.io/en/latest/)
- [AWS Lambda Developer Guide — Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
