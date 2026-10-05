<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🏛️ Application Architecture](../../README.md#application-architecture)

# Microkernel (Plug-in)

> A minimal core system extended by independent plug-in modules.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Microkernel (Plug-in)" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/microkernel.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · A small core, plug-ins** | The **core** keeps only what every user needs: the window, opening, editing and saving files, settings, a **plug-in registry**, the plug-in lifecycle and the **extension points**, which are contracts for language support, commands and views. Each plug-in ships a **manifest** that declares what it adds, when it should activate and which versions of the core API it needs. At start-up the core reads the manifests without running any plug-in code, registers each plug-in and wires its contributions in: Git activates at start-up, and Python activates because a `.py` file is open. Most of what the user now sees comes from plug-ins. |
| **2 · Add without touching core** | A **Markdown preview** plug-in is installed. The core finds its manifest and registers its command and view, but runs none of its code yet: the plug-in **activates lazily**, the first time a Markdown file is opened. Nothing in the core or in the other plug-ins is changed or redeployed, and the Python plug-in is upgraded from 1.4 to 1.5 on its own schedule. |
| **3 · Contain a hung plug-in** | The plug-ins run in a separate **plug-in host process** and reach the core only through its API. When the Git plug-in hangs in an endless loop, the plug-ins that share the host stall with it, but the editor keeps responding to typing. The core notices that the host has stopped answering and tells the user, who can restart the host or, as here, disable Git and restart the host without it. The host is **sandboxed**, so a plug-in can do only what the API grants it. |
| **4 · The API is the hard part** | The core API moves to **version 2**, which renames `addCommand()` to `registerCommand()`. Plug-ins that declare API 1.x keep working through a **compatibility layer**, deprecated now and removed in v3, while an old plug-in that needs API 0.x, whose support is already gone, is **refused at load time** instead of failing later. The contract has other costs too: plug-ins that depend on each other, two plug-ins competing for one extension point, start-up time when many activate early, and the number of combinations to test. |
<!-- END GENERATED: header -->

## The problem

Some products are used by very different people for very different work. The users of a code editor want support for their own languages, version control, linters and previews; the users of a CI server want their own build tools, clouds and notifications; an insurer's claims system has to follow different rules in every jurisdiction it serves. Building every one of those features into one codebase goes wrong in predictable ways:

- **Every feature ships with every release.** A fix for one language waits for the next release of the whole product, and each release can break features that nobody touched.
- **Every user pays for everything.** Start-up time and memory grow with features that most users never open.
- **Only the vendor can extend it.** Customers, partners and the community can't add what they need without a fork.
- **Variation leaks everywhere.** A rule that differs by customer or region turns into conditionals spread through the code, and every new variant edits the same files.

## How it works

Split the product into two kinds of parts: a small **core system** that changes rarely, and **plug-ins** that add features through contracts the core defines. Mark Richards, who describes the style in *Software Architecture Patterns*, also calls it the **plug-in architecture**.

**What belongs in the core: as little as possible.**

- **Lifecycle:** finding plug-ins, loading them, activating them and shutting them down.
- **Registry:** which plug-ins exist, what each one contributes and what state it is in.
- **Contracts:** the extension points and the API that plug-ins are written against.
- **Shared services** that every plug-in needs and that must behave the same everywhere: settings, storage, logging, and in a product with a user interface, the window and basic editing.

Features go into plug-ins, including many that the vendor ships itself. The Eclipse documentation describes its runtime (the `org.eclipse.osgi` and `org.eclipse.core.runtime` plug-ins) as a minimal kernel that all other plug-ins depend on, and the rest of the platform, its own subsystems included, is built as sets of plug-ins.

**Extension points and contracts.** An extension point is a named place where plug-ins may add something, with a contract that says what and how. Contracts come in three shapes, and most systems mix them:

- *Interfaces* that a plug-in implements: Java `ServiceLoader` services, OSGi services, Jenkins extension points.
- *Events or hooks* that a plug-in subscribes to: a file was opened, a build finished.
- *Declarative contributions* in the manifest: commands, menus, views, languages, settings. The core can list a command or show a view's entry before it runs a line of the plug-in's code. Eclipse plug-ins declare their extensions and extension points in `plugin.xml`, and the [Eclipse guide](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/runtime_model.htm) likens defining an extension point to defining an API, only in XML rather than as a code signature. Visual Studio Code extensions do the same in the `contributes` section of their `package.json`.

**Discovery and registration.** The core has to find plug-ins it was not compiled with:

- **Java's [`ServiceLoader`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ServiceLoader.html)** finds *providers* of a service interface. On the class path, a provider is listed in a file under `META-INF/services/` named after the interface; in the module system, the provider's module declares `provides … with …` and the consumer's module declares `uses`. Providers are located and instantiated lazily, and `stream()` lets the core look at a provider's type before creating an instance.
- **OSGi** packages each plug-in as a *bundle*: a JAR whose manifest names and versions it and lists the packages it imports and exports, with version ranges. The framework gives each bundle its own class loader and resolves its imports before the bundle may start. Bundles also publish objects in a shared *service registry* under interface names, where other bundles look them up; services come and go while the system runs, and a bundle's services are unregistered when it stops.
- **Manifest-driven systems** read a file that ships with the plug-in: VS Code's `package.json`, Eclipse's `plugin.xml`, Zed's `extension.toml`, a browser extension's `manifest.json`.
- **Annotations and scanning.** Jenkins finds classes marked `@Extension`, creates them and registers them as implementations of the extension point they extend, whether that point is defined in Jenkins core or in another plugin. Scanning is convenient but slow: Kafka Connect's `plugin.discovery` setting offers a `service_load` mode that reads `ServiceLoader` manifests instead of scanning every plugin by reflection, and its [user guide](https://kafka.apache.org/43/kafka-connect/user-guide/) points out how much that choice affects worker start-up time.

**Lifecycle and lazy activation.** Registering a plug-in and activating it are separate steps (steps 1 and 2 of the diagram). OSGi defines the states a bundle goes through (installed, resolved, starting, active, stopping, uninstalled), and a bundle can declare a *lazy* activation policy so that it is activated only when one of its classes is first loaded. Eclipse states the goal plainly: plug-ins that are installed but not used should cost neither memory nor performance. Because extensions are declared, the runtime knows what a plug-in offers without running it, and activates it only when the user asks for something it provides. VS Code expresses the same idea as [activation events](https://code.visualstudio.com/api/references/activation-events) such as `onLanguage:markdown`, `onCommand`, `workspaceContains` and `onStartupFinished`; since version 1.74, contributing a command, view or language is enough to activate the extension when it is used. The `*` event, which activates an extension as VS Code starts, is discouraged: `onStartupFinished` runs a little later without slowing start-up down. A plug-in also gets a chance to clean up when it is deactivated (VS Code calls its `deactivate()` function).

**Isolation: where plug-in code runs.** Each option buys safety with speed and API reach:

| Option | Examples | What it protects | What it costs |
|---|---|---|---|
| In-process | `ServiceLoader` providers, OSGi bundles, Jenkins plugins, Envoy's built-in filters | Little: separate class loaders keep libraries apart, but a crash, leak or endless loop hits the whole product | Nothing at run time: calls are plain function calls and plug-ins can share objects with the core |
| Separate process | VS Code's extension host | The user interface and the core: a stuck plug-in cannot freeze the editor | Every call becomes a message, so the API must be asynchronous; plug-ins in the same host still share its fate; not a security boundary on its own |
| Sandbox with permissions | Browser extensions | Data and capabilities: a plug-in gets only what its manifest declares and the user accepts | Every capability has to be designed as a permission, and the protection is only as good as the user's reading of the warnings |
| WebAssembly | Zed extensions (built as WebAssembly components), Envoy's Wasm filters | Memory and capabilities: a module can reach the outside world only through the functions the host gives it | Data is copied across the boundary, and some libraries and language features don't work unchanged inside it |

The editor in the diagram uses a separate host process that is also sandboxed. A process boundary on its own contains hangs and crashes, not permissions: VS Code's [runtime security page](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) says extensions run with the same permissions as VS Code itself, so they can read and write files, make network requests and start processes. Its [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host) runs on Node.js locally or on a remote machine, or in a web worker in the browser, and keeps extensions from slowing the user interface or changing it directly. Zed takes the other route: its extensions are compiled to WebAssembly, and a [capability system](https://zed.dev/docs/extensions/capabilities), which users can narrow with `granted_extension_capabilities`, decides what an extension may do, such as running a process or downloading a file. One host process per plug-in would isolate plug-ins from each other as well, at the price of a process each.

**When a plug-in hangs (step 3).** VS Code's [release notes for version 1.28](https://code.visualstudio.com/updates/v1_28) introduced a notification for an unresponsive extension host: when the host stops acknowledging the editor's messages, VS Code says so and suggests waiting, profiling the host from the Running Extensions view, or restarting it if an extension looks stuck in a loop. For problems that are harder to pin down, [extension bisect](https://code.visualstudio.com/blogs/2021/02/16/extension-bisect) disables half of the installed extensions at a time until it finds the one at fault.

**Plug-ins are third-party code.** Treat them as part of your supply chain:

- **Least privilege.** Make plug-ins declare what they need and grant it explicitly: Chrome extensions list [`permissions` and `host_permissions`](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) in their manifest, and can ask for optional ones at run time instead of at install time.
- **Signing.** The Visual Studio Marketplace signs every extension it publishes and VS Code checks the signature when it installs one. Since version 1.97, VS Code also asks the user to trust a third-party publisher before installing its extensions.
- **Marketplaces police what they host.** The Visual Studio Marketplace scans every new version with several malware scanners, runs extensions in an isolated environment to watch how they behave, marks publishers who have proven they own their domain, stops authors from taking the names of official publishers and popular extensions, and removes malicious extensions, which VS Code then uninstalls automatically.
- **An update is a code change.** It can bring new dependencies, new permissions and new behaviour. Pin versions where you can, review what an update asks for, and keep an allow list where machines are managed.

**Versioning the core API (step 4).**

- **Give the numbers a meaning.** With [semantic versioning](https://semver.org/spec/v2.0.0.html), the major version changes when the API changes incompatibly, the minor version when compatible features are added, and the patch version for compatible fixes.
- **Plug-ins declare what they need.** A VS Code extension must state `engines.vscode`, for example `^1.8.0` for 1.8.0 and later, so that it is installed only into editors that have the API it depends on. OSGi bundles import packages with ranges such as `[1.23,2)`. A Jenkins plugin is built against a minimum Jenkins version, and the update center does not offer a plugin release whose requirements, typically a newer Jenkins, the installed core doesn't meet.
- **Check early and refuse clearly.** A plug-in refused at load time because it needs API 0.x is far easier to deal with than one that fails with a missing method the first time someone clicks its command.
- **Deprecate before you remove.** Keep the old names working through a compatibility layer, mark them deprecated, say which version will remove them, and give authors time to move. Jenkins applies the idea when it moves a feature out of core into a plugin: a plugin built against an older core gets an implied dependency on the new plugin, so it keeps working. In the diagram, `addCommand()` keeps working through the v1 layer until v3.
- **Stage new API before freezing it.** VS Code first ships new API as [proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api): available only in the Insiders build and not allowed in published extensions, so it can still change. Once an API is stable, the team works hard not to break it.
- **The deeper the contract, the more fragile it is.** Envoy's [dynamic modules](https://www.envoyproxy.io/docs/envoy/v1.39.0/intro/arch_overview/advanced/dynamic_modules) are shared libraries loaded into the proxy through an ABI that is tied closely to Envoy's internals; in Envoy 1.39 a module built for one release is guaranteed to work with that release and the next one only, a stricter rule than for Envoy's other extension mechanisms.

**Dependencies and ordering between plug-ins.**

- **Declare dependencies.** VS Code has `extensionDependencies`; its `extensionPack` only bundles extensions to be installed together and is not meant for real dependencies. OSGi has `Import-Package` and `Require-Bundle`, and Jenkins plugins depend on other plugins.
- **Load in dependency order,** reject cycles, and decide what happens to dependants when a plug-in is disabled, as Git is in step 3: disable them too, or let them run without the missing feature.
- **Expect two plug-ins to claim the same thing.** OSGi orders competing services by their `service.ranking` property (highest first, then the earliest registered). VS Code added the `editor.defaultFormatter` setting in version 1.33 so that users can choose between several formatters for one language. In Envoy, the order of HTTP filters in the configuration is the order in which they see a request, and responses pass through them in reverse.

**Where you meet it.**

- **Editors and IDEs.** VS Code (extension host, activation events, `engines.vscode`), Eclipse (OSGi underneath, extension points and the extension registry on top), Zed (WebAssembly extensions with capabilities).
- **CI servers.** Jenkins is a core plus plugins; extension points are defined in core and in plugins, and its plugin bill of materials (BOM) lists plugin versions that have been tested together.
- **Browsers.** Extensions declare their permissions in a manifest, and the browser shows the user what they ask for.
- **Infrastructure.** Kafka Connect loads connectors, converters and transformations as plugins from `plugin.path`; Envoy adds behaviour as filters that are compiled in, loaded as Wasm modules or loaded as dynamic modules.
- **Business rules as plug-ins.** In the first edition of *Software Architecture Patterns*, Richards illustrates the style with an insurer's claims processing: the core handles the steps every claim goes through, and the rules of each US state, which differ from state to state, live in plug-ins. Adding a state or changing one state's rules touches a single plug-in, which can be tested and released on its own instead of inside one large rule set that every change edits.

**At other scales.** A whole product is not required. One module of a [modular monolith](../modular-monolith/) can be a small core with plug-ins (payment methods or file importers behind one contract, for example), and so can a single [microservice](../microservices/). Plug-ins can even be separate services that implement a published contract, at the price of a network call for every interaction. A [sidecar](../sidecar/) applies a related idea at deployment time: it adds capabilities next to a service in a separate process without changing the service's code.

**Not the same as adapters or layers.**

- [Hexagonal architecture](../hexagonal-architecture/) also puts a core in the middle, but its adapters connect that core to technologies (HTTP, a database, a broker) and add no behaviour: swapping the SQL adapter for a document store changes nothing the user can see. A plug-in adds a feature, so installing one changes what the product can do. In hexagonal architecture the core defines ports for what *it* needs; in a microkernel the core defines extension points for what *others* may add. The two combine well: the core can be built as a hexagon, and a plug-in that talks to an outside system can use adapters, or an [anti-corruption layer](../anti-corruption-layer/) so that the system's model doesn't leak into the contract.
- [Layered architecture](../layered-architecture/) stacks code by technical role, and a request travels down through the layers. A microkernel splits by feature: the core and each plug-in may be layered inside, but the main seam runs between the fixed core and the variable features.
- [Feature flags](../feature-flags/) switch code that is already in the product on or off; a plug-in adds code the core has never seen. They work well together: a flag can roll a new plug-in out to some users first.

**The other microkernel.** In operating systems the word names a kernel design: only a minimal core runs in the processor's privileged mode, and services such as device drivers and file systems run as separate processes on top of it, communicating through the kernel. Carnegie Mellon's [Mach project](https://www.cs.cmu.edu/afs/cs/project/mach/public/www/overview.html) (1985–1994) built one; the L4 family followed in the mid-1990s, and one of its members, [seL4](https://sel4.systems/About/seL4-whitepaper.pdf), comes with a machine-checked proof that its implementation is correct. Richards notes that the application style has its roots there. This page is about the application style: its plug-ins are product features, not drivers.

## When to use it

- **Products that many people extend in different ways:** editors and IDEs, browsers, CI servers, integration platforms, proxies.
- **Variation by customer, market or jurisdiction:** claims or tax rules per region, importers per file format, payment methods per country, where each variant can be built and tested on its own.
- **Third parties should add features without waiting for your release,** or you want an ecosystem around the product.
- **Heavy, optional features** that most users never open: lazy activation keeps them from costing anything until someone uses them.

**When not to use it:**

- **Nothing varies.** If every customer runs the same features, extension points are ceremony; a well-structured [modular monolith](../modular-monolith/) is simpler.
- **Plug-ins need deep access to the core's internals.** Then the contract is effectively the whole core, every internal change breaks plug-ins, and the isolation of step 3 is out of reach.
- **The core itself keeps changing.** Contracts need a stable core. While the core's own design is still moving, extension points freeze the wrong things; keep features in the core until the seams are clear.
- **The "plug-ins" are really separate applications** with their own data, teams and release cycles: separate [services](../microservices/) may fit better.

## Trade-offs

- **The contract becomes the product.** Once others build on an extension point, every change to it needs a version, a compatibility plan and a deprecation window (step 4).
- **Compatibility layers pile up.** Each one is code to test and maintain, and the core carries it until the removal date it promised.
- **Isolation has a price.** In-process plug-ins are fast but can take the product down; out-of-process plug-ins protect the core, but every call is a message, the API becomes asynchronous, and debugging crosses process boundaries.
- **Start-up time and memory.** Discovery by scanning, eager activation and many active plug-ins slow start-up down. Measure activation time per plug-in.
- **Plug-ins interact.** Dependencies, ordering, conflicts over one extension point and a shared host process cause problems that no single plug-in's tests reveal.
- **The combinations can't all be tested.** What a user runs is the core plus their own set of plug-ins at their own versions.
- **Security.** Every plug-in is code that someone else wrote, running with whatever access the core gives it.
- **Support.** Users report bugs against the product; finding the plug-in at fault takes tooling such as bisecting and per-plug-in profiling.

## Implementation notes

- **Publish the contract on its own.** Put the extension points and the API in a separate package (an SDK or API module) with its own version, and keep the core's internals out of it. Plug-ins compile against that package only.
- **Make manifests declarative and complete:** identity, version, contributions, activation events, the API range, dependencies and permissions. The core should be able to register a plug-in, build its menus and check compatibility without loading its code.
- **Activate lazily by default,** and make eager activation something a plug-in has to justify.
- **Call plug-ins defensively:** never on the user-interface thread, with timeouts, behind an error boundary that disables a plug-in after repeated failures and tells the user which one it was.
- **Check ranges at install time and again at load time,** with a message that names the plug-in, the API range it needs and the range the core offers.
- **Deprecate in public:** mark the old API, warn when a plug-in still uses it, name the version that removes it, and keep that promise.
- **Test at three levels:**
  - *the contract:* a test suite that every implementation of an extension point must pass, run against the core's own built-in plug-ins too;
  - *each plug-in against the core versions it claims:* VS Code's `@vscode/test-cli` and `@vscode/test-electron` run an extension's [integration tests](https://code.visualstudio.com/api/working-with-extensions/testing-extension) inside a real VS Code instance, the Extension Development Host, with full access to the API;
  - *the combinations people actually run:* Jenkins plugin authors can build against the [plugin bill of materials](https://www.jenkins.io/doc/developer/plugin-development/dependency-management/), a set of plugin versions tested together.
- **Observe per plug-in:** activation time, errors, CPU and memory, so that a slow start-up or a hung host points at a plug-in instead of at the whole product.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Hexagonal (Ports & Adapters)](../hexagonal-architecture/) — Domain logic at the core; UIs, databases and queues plug in through ports and adapters.
- [Layered (N-Tier)](../layered-architecture/) — Presentation, business and data layers; each layer only calls the one directly below it.
- [Modular Monolith](../modular-monolith/) — One deployable unit built from strongly bounded modules that talk through explicit interfaces.
- [Microservices](../microservices/) — Small, independently deployable services, each owning one business capability and its data.
- [Sidecar](../sidecar/) — Run helper capabilities (proxy, logging, config) in a separate process next to the app.
- [Anti-Corruption Layer](../anti-corruption-layer/) — A translation layer that keeps a legacy model from leaking into the new domain.
- [Feature Flags](../feature-flags/) — Deploy code dark, then turn features on per user or percentage at runtime.

## References

- [Mark Richards — Software Architecture Patterns (O'Reilly; 1st edition 2015, 2nd edition 2022), listed on the author's publications page](https://www.developertoarchitect.com/books.html)
- [Mark Richards — Software Architecture Monday, Lesson 160: Microkernel Architecture](https://developertoarchitect.com/lessons/lesson160.html)
- [OSGi Core Release 8 specification](https://docs.osgi.org/specification/osgi.core/8.0.0/)
- [Visual Studio Code — Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Visual Studio Code — Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Visual Studio Code — Activation Events](https://code.visualstudio.com/api/references/activation-events)
- [Visual Studio Code — Extension runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [Eclipse Platform Plug-in Developer Guide — The runtime plug-in model](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/runtime_model.htm)
- [Jenkins developer documentation — Extensibility](https://www.jenkins.io/doc/developer/extensibility/)
- [Java SE 25 API — java.util.ServiceLoader](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ServiceLoader.html)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [Zed — Extension Capabilities](https://zed.dev/docs/extensions/capabilities)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
