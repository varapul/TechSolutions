<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Valet Key

> Give clients a short-lived, narrowly scoped URL to read or write storage directly.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Valet Key" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/valet-key.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · The API in the data path** | Ana uploads her 2 GB video, `video-981.mp4`, to the API, which streams it on to storage using its own credentials. Every byte crosses the application on the way in and again on the way out, so an instance is busy for minutes, needs long timeouts and large buffers, and the API tier ends up scaled for bandwidth instead of for its logic. |
| **2 · Ask for a key, not data** | The client asks the API for permission to upload `video-981.mp4`. The API authenticates Ana, checks that she may add videos to this album, and signs a **valet key**: a URL that allows writing that one object only, for 15 minutes, over HTTPS, optionally with a size limit and a content type. The signature is made with credentials that never leave the server; the client receives only the signed URL. |
| **3 · Straight to storage** | The client sends the file straight to storage with the signed URL. Storage checks the signature, the expiry, the object name and the operation, then accepts the bytes; the API is not involved. When the object lands, a storage event triggers processing: the file is scanned and validated before anything else uses it, and quarantined if it fails. This one is clean, so the thumbnail worker gets it. |
| **4 · A leaked key does little** | Someone copies the URL. It can write only `video-981.mp4`, and only until it expires: a read or a delete with it is refused, and after 15 minutes so is everything. Taking a key back before it expires is the hard part, so keep lifetimes short and sign with credentials or a policy you can revoke, such as an Azure user delegation key or stored access policy, or an AWS role session. Downloads work the same way: a short-lived, read-only URL for one object. |
<!-- END GENERATED: header -->

## The problem

Applications that accept or serve large files (videos, photos, documents, backups, datasets) often start by putting the API in the middle. The client uploads to the API, and the API writes the bytes to object storage with its own credentials; downloads take the same route in reverse. It works, but it puts the application in the **data path**:

- **Every byte crosses the application twice.** In from the client, then out to storage (or the other way round for downloads). You pay for compute that only copies bytes, and for every network hop in between: load balancers, gateways, NAT.
- **Requests that last for minutes.** A 2 GB upload over a home connection takes minutes. For that whole time the request holds a connection, a worker and memory or disk buffers, and every layer in front of it (load balancer, API gateway, serverless platform) needs timeouts and body-size limits generous enough to let it through. Many managed gateways and function platforms cap both.
- **Scaling for the wrong thing.** The API tier ends up sized for bandwidth and concurrent transfers instead of for the work only it can do, and a burst of uploads slows down every other API call.
- **Fragile transfers.** When the connection drops, the upload starts again through the API, which streams it all over again.

The obvious shortcut, giving clients the storage credentials, is worse. Those credentials usually allow any operation on any object, can't be narrowed to one user's file, and can't be taken back from a device without rotating them for everyone.

## How it works

Like a car's valet key, which starts the engine but doesn't open the boot, a **valet key** grants just enough access, and here only for a short while. The application keeps deciding *who may do what*, but steps out of the *data path*: it hands the client a short-lived, narrowly scoped token, in practice a signed URL, that the storage service can verify on its own. The client then moves the bytes straight to or from storage.

1. **The API in the data path (before).** Ana uploads her 2 GB `video-981.mp4` to the API, which streams it on to storage. The API instance is busy for minutes, and every byte passes through it twice.
2. **Ask for a key, not for the data.** The client asks the API for permission to upload `video-981.mp4`. The API authenticates Ana (for example by [validating her access token](../jwt-validation/)), checks that she may add videos to this album, chooses the object name, and signs a URL that allows **one operation** (write) on **one object** (`albums/ana/video-981.mp4`) for **15 minutes**, over **HTTPS**, optionally with a size limit and a content type. The signing credentials never leave the server; the client receives only the URL.
3. **Straight to storage.** The client uploads with the URL. Storage verifies the signature and checks the expiry, the object name and the operation (plus any other signed conditions) before it accepts the bytes. The API is not involved. When the object is committed, storage emits an event, and processing starts: a scanner validates the file and scans it for malware before anything else uses it, and quarantines it if it fails. This one is clean, so a thumbnail worker picks it up. The processing is plain [event-driven architecture](../event-driven-architecture/).
4. **A leaked key does little.** A copied URL can do only what it says: write that one object until it expires. A read or a delete with it is refused, and after 15 minutes so is everything. Taking a key back before it expires is the hard part (see *Revocation and leaks* below). Downloads work the same way, with a short-lived read-only URL.

Issuing a key is a small cryptographic operation, not a call that moves data, so one API instance can hand out keys for many transfers at once.

### How each provider implements it

**Azure Storage: shared access signatures (SAS).** A SAS is a set of query parameters on the resource URL: the signed resource (a blob, a container or a directory), the permissions (such as *create*, *write*, *read* and *delete*), the start and expiry times, optionally an allowed IP range and protocol, and the signature. There are three kinds:

- **User delegation SAS.** Signed with a *user delegation key* that the application requests with its Microsoft Entra identity, typically a managed identity, so no account key is involved. Microsoft recommends this kind whenever you use a SAS. It works for Blob Storage (including Data Lake Storage), Queue Storage, Table Storage and Azure Files. The key, and so every SAS signed with it, is valid for at most seven days, and when the SAS is used Azure also checks that the identity behind the key still holds the permissions it delegates.
- **Service SAS.** Signed with the storage account key, for resources in one service.
- **Account SAS.** Also signed with the account key; it can cover several services and allows some operations that a service SAS can't.

A **stored access policy** on a container, table, queue or share holds the start time, expiry and permissions for every service SAS that refers to it (at most five policies per container), so editing or deleting the policy changes or revokes those SASes at once; a change can take up to 30 seconds to apply. User delegation and account SASes can't use stored access policies. Since service version 2025-07-05, a user delegation SAS can also be bound to one Microsoft Entra user (the `sduoid` field), who must present their own bearer token along with it; that suits workforce applications more than consumer ones. Two account-level guardrails help: a **SAS expiration policy** logs (the default) or blocks any SAS valid for longer than you allow, and **disallowing Shared Key authorization** makes Blob Storage refuse service and account SASes while user delegation SASes keep working.

**Amazon S3: presigned URLs and presigned POST.** A presigned URL carries an AWS Signature Version 4 signature for one request, such as a `PutObject` or `GetObject` on one key, with an expiry. It acts with the permissions of whoever signed it, and it is a bearer token: anyone who holds it can use it, as often as they like, until it expires.

- **The lifetime depends on the signing credentials.** Signed with an IAM user's access keys through the AWS CLI or SDKs, a URL can last up to seven days (the console allows 1 minute to 12 hours). Signed with temporary credentials (an IAM role session, the role credentials of an EC2 instance, which typically last six hours, or other AWS STS credentials), it can't outlive them. A URL also stops working when the credentials that signed it are revoked, deleted or deactivated, whatever expiry it carries.
- **Expiry is checked when a request starts.** A download that began in time is allowed to finish, but a retry after the expiry fails.
- **A presigned PUT replaces** an existing object with the same key. Conditional writes (`If-None-Match: *`) prevent that, and a bucket policy can require them.
- **Presigned POST** is for HTML form uploads from browsers. The server signs a *POST policy* with an expiration and conditions: an exact bucket and key, a `starts-with` prefix for the key or the content type, and `content-length-range` for the minimum and maximum size.
- **Bucket policies add guardrails** that apply to presigned requests too: `s3:signatureAge` refuses signatures older than you allow, `aws:SourceIp`, `aws:SourceVpc` and `aws:SourceVpce` restrict the network path, and `aws:SecureTransport` refuses plain HTTP.

**Google Cloud Storage: V4 signed URLs and signed policy documents.** A V4 signed URL grants one kind of request (the method, the object and any signed headers) for at most seven days (604,800 seconds). It is usually signed for a service account, either with that account's private key or, without handling a key at all, through the IAM `signBlob` method; an HMAC key also works. The signing account must itself be allowed to make the request, and anyone who holds the URL can use it until it expires. The client has to send the signed headers as they were signed, so a URL can pin the `Content-Type`, or an `x-goog-content-length-range` header that bounds the size of a PUT. For browser form uploads, a **policy document** plays the part of S3's POST policy, with `eq`, `starts-with` and `content-length-range` conditions. For large files, the server can start a **resumable upload** and give the client the session URI, which works as a bearer credential for up to a week.

### Scoping a key

Give each key the least it needs:

- **One object, named by the server.** Generate the object name (`albums/ana/video-981.mp4`, or a random ID) instead of using the client's file name, as the OWASP File Upload Cheat Sheet advises. Keys for a whole prefix (an Azure container or directory SAS, or an S3 or Cloud Storage form policy with `starts-with` on the key) are for batches that really need them.
- **One operation.** Write (or create) for uploads, read for downloads; never list or delete unless that is the job.
- **A short expiry.** Minutes: long enough to start the transfer and retry once, too short to be worth stealing. Issue a fresh key for the next attempt rather than one long-lived key.
- **HTTPS only.** An Azure SAS accepts HTTP and HTTPS unless you set its protocol field to HTTPS only (`spr=https`); new storage accounts also require secure transfer by default. On S3, use a bucket policy on `aws:SecureTransport`.
- **Size and type, where the service can enforce them.** S3 presigned POST (`content-length-range`), Cloud Storage policy documents and the `x-goog-content-length-range` header bound the size at upload time, and a presigned PUT can pin the `Content-Type`. A SAS has no size condition, so on Azure you check the size afterwards; the Azure Architecture Center notes that most key mechanisms can't limit the size of an upload. Either way, a declared content type proves nothing about the bytes (see *Validating what arrives*).
- **No overwrites.** S3 conditional writes and Azure's *create* permission stop a key from replacing an object that already exists. On Azure, *create* allows a new blob in a single Put Blob request; uploading block by block needs *write*.
- **Client IP ranges, where supported.** An Azure SAS can carry an IPv4 range (`sip`), and S3 bucket policies can test `aws:SourceIp`. They rarely help with mobile and home clients, whose addresses change.

### Issuing the key

- **Authenticate and authorise first.** The key endpoint is an ordinary API call: validate the caller's token ([JWT validation](../jwt-validation/)), then apply your own rules: Ana may add videos to *this* album, within her quota, up to a maximum size. A key is only as narrow as the decision behind it.
- **Sign with an identity, not a stored secret.** Use a managed identity and a user delegation SAS on Azure, an IAM role on AWS, and a service account through `signBlob` on Google Cloud. Give the signing identity only the permissions the keys should ever grant: on all three services, a key can't do more than its signer may.
- **Deliver it over HTTPS and keep it out of logs.** Return the URL in the response body. A redirect to a signed URL lands in browser history, which is acceptable for a download link but not for an upload key.
- **Record what you issued**: who, which object, which operation, and when it expires, so that storage logs can be matched to the decision that allowed them. Azure suggests making SAS fields such as the expiry time unique per client for the same reason.
- **Mind clock skew.** Azure recommends leaving the start time out of a SAS, or setting it at least 15 minutes in the past. Under a SAS expiration policy, set it: the policy counts a SAS without a start time as out of policy, and its *block* action refuses it. Cloud Storage accepts a V4 signature from 15 minutes before its `X-Goog-Date`.

### Validating what arrives

A valet key controls *who may write where*, not *what they write*. Treat every upload as untrusted until it has been checked:

- **Process on storage events.** S3 Event Notifications (to Amazon SQS, Amazon SNS or AWS Lambda, or through Amazon EventBridge), Azure Event Grid's `BlobCreated` event (filter it to `PutBlob`, `PutBlockList`, `CopyBlob` and `FlushWithClose` so it fires only for fully committed blobs), or Cloud Storage Pub/Sub notifications (`OBJECT_FINALIZE`, which a failed upload doesn't trigger). All three deliver events at least once, so make the processing idempotent ([idempotent consumer](../idempotent-consumer/)).
- **Check the real file.** Check the size and the file's actual format (its signature bytes), not the declared `Content-Type`, which the client controls. The OWASP File Upload Cheat Sheet covers this, along with malware scanning and content disarm and reconstruction for document formats.
- **Scan for malware.** Managed options include Microsoft Defender for Storage on-upload malware scanning and Amazon GuardDuty Malware Protection for S3, which can tag each object with its scan result. Elsewhere, run your own scanner from the event.
- **Quarantine until clean.** Upload into an *incoming* container or prefix that nothing else reads, then promote clean files (or flip a status in your database) and move failures to quarantine. Readers should never see a file that hasn't been scanned.
- **Close the loop with the API.** The client reports completion, or the API learns of it from the event, so the API can record the upload, stop issuing keys for that object and show Ana her video.

### Revocation and leaks

A signed URL is a bearer credential, so treat it like a password with a timer.

- **Where they leak:** access logs of servers, proxies and CDNs (the query string is part of the URL), browser history, analytics and error-reporting tools, chat messages and support tickets, and the `Referer` header. Browsers send only the origin to other sites by default (`strict-origin-when-cross-origin`), but the full URL still goes along with same-origin requests and under looser policies, so serve `Referrer-Policy: no-referrer` on pages that handle signed URLs.
- **Keep them out of logs.** Strip query strings or signatures before logs leave the host or the pipeline ([centralized logging](../centralized-logging/)), and restrict who can read storage access logs.
- **Revoking early depends on how the key was signed**, and always works at a coarser grain than one URL:
  - *Azure:* delete, rename or expire the stored access policy behind a service SAS. For a user delegation SAS, revoke the account's user delegation keys or remove the signing identity's role; both are cached, so the change takes effect after a delay. For a SAS signed with an account key, rotate the key, which invalidates every SAS signed with it.
  - *AWS:* deactivate or delete the access key that signed the URL, or sign with a dedicated IAM role and revoke the role's active sessions, which denies every session credential issued before that moment, and with it the URLs those credentials signed. A bucket policy that denies the request works too.
  - *Google Cloud:* delete the key that signed the URLs: a service account key, or an HMAC key, which stops working immediately. URLs signed through `signBlob` use a key that Google holds and rotates, so for those, rely on short expiries.
- **Revocation is coarse, so separate the signers.** A dedicated signing identity or policy per purpose (uploads and downloads, or one per tenant) lets you cut one off without breaking the rest.

### Large files

- **Amazon S3.** A single PUT carries up to 5 GB, and AWS suggests considering multipart upload from about 100 MB. A multipart upload has up to 10,000 parts of 5 MiB to 5 GiB each, for objects up to 50 TB. The server starts the upload and presigns one URL per part; the client uploads the parts in parallel and returns their ETags; the server completes the upload. Add a lifecycle rule that deletes incomplete multipart uploads.
- **Azure Blob Storage.** The client libraries send large blobs as blocks (Put Block, then Put Block List), which a SAS with *write* permission allows; the `BlobCreated` event fires once the block list is committed.
- **Google Cloud Storage.** Use a resumable upload: the server starts the session and gives the client the session URI, which survives dropped connections for up to a week. The session is pinned to the region where it started.
- **Key lifetime versus transfer time.** The key must stay valid for the whole transfer, including retries of individual parts. Instead of one long-lived key, issue per-part URLs or let the client ask for a fresh key.

### Browser uploads and CORS

A page served from `app.example` that sends a PUT to the storage endpoint makes a cross-origin request, so the bucket or storage account needs a CORS rule. Allow the app's origin, the method (PUT or POST) and the request headers the upload sends (`Content-Type`, plus `x-ms-blob-type` for an Azure Put Blob request), and expose `ETag` if the browser has to read the ETags of multipart parts. HTML form uploads (S3 presigned POST, Cloud Storage policy documents) let a plain browser form post straight to storage.

### Downloads

- **The same idea in reverse.** After checking that the user may see the object, return a read-only URL for that object with a short expiry, or redirect the browser to it.
- **Set response headers through the key** where the service allows it: S3's `response-content-disposition` and related parameters (which only work in signed requests), or the SAS fields that override headers such as `Content-Disposition` and `Cache-Control` on Azure. A file that should be saved is then downloaded instead of being displayed.
- **Through a CDN.** For content served at scale, put a CDN in front and check signatures at the edge: Amazon CloudFront signed URLs (for one file) or signed cookies (for many files, such as every segment of an HLS video), and Google Cloud CDN signed URLs and signed cookies. Keep the bucket private so users can't go around the CDN's checks; CloudFront recommends requiring its URLs for exactly that reason. See [CDN & edge caching](../cdn-edge-caching/).

### Network reachability

A key authorises a request; it doesn't open a network path. Azure Storage applies its firewall and virtual network rules to SAS requests too (a SAS's IP range narrows access but never widens it beyond the network rules), and S3 bucket policies on `aws:SourceIp`, `aws:SourceVpc` or `aws:SourceVpce` apply to presigned requests. If a storage account or bucket accepts traffic only through [private endpoints](../private-endpoints/), clients on the internet can't use a valet key against it: they need a public endpoint or a CDN in front, while internal clients keep using the private path.

### Where it sits among other patterns

- **[Gatekeeper](../gatekeeper/)** makes the opposite trade: a hardened broker stays in the path and validates and sanitises every request before it reaches trusted storage. Choose it when data must be inspected before it is stored; choose a valet key when the store can enforce the limits and validation can happen afterwards.
- **Tokens for APIs.** [JWT validation](../jwt-validation/) and [OAuth 2.0 client credentials](../oauth2-client-credentials/) are about calling APIs as a user or as a service. A valet key is narrower: permission for one storage operation, which the store verifies without knowing who Ana is.
- **[Zero trust access](../zero-trust-access/).** Each request carries its own short-lived, least-privilege proof, and the resource verifies it every time, which fits a zero trust design. The storage sees no user or device context, though, so the access policy belongs where the key is issued.
- **Background work.** The event that starts the scan usually feeds a queue and a pool of workers, as in Web-Queue-Worker and [competing consumers](../competing-consumers/).

## When to use it

- Large or numerous uploads and downloads: media, documents, backups, datasets, build artefacts.
- Browser and mobile clients that should talk to storage directly, especially when the API runs on serverless or gateway platforms with limits on request size or duration.
- Sharing a file for a limited time with someone who has no account on your storage, such as a partner or a support engineer.
- Spiky upload traffic that would otherwise force you to scale the API tier.

**When not to use it:**

- **The application must transform the data anyway**, for example to re-encode it, encrypt it with keys only the application holds, or merge it with other data before storing it. It is in the data path regardless.
- **Data must be inspected before it is stored**, for example when policy forbids keeping unscanned content even in quarantine. Put a gatekeeper in the path instead.
- **You need exact control over each transfer**, such as single use or a precise download count, and the store can't enforce it.
- **The clients can't reach the storage**, for example when it accepts only private network traffic.
- **Small payloads**, where the extra round trip for the key costs more than streaming through the API.

## Trade-offs

- **Less control during the transfer.** A key can be used again and again until it expires, and some services can't limit the size of an upload.
- **Revocation is coarse.** Usually you can only cut off every key signed with the same credentials or policy.
- **More work on the client:** ask for a key, upload, retry, renew, report completion, and CORS for browsers.
- **Validation moves after the upload.** You need quarantine, scanning and event processing, and a way to show "processing" to the user.
- **Auditing spans two systems:** the API's record of issued keys and the storage access log, joined by object name and time.
- **Storage faces the clients.** It has to be reachable from where they are, and its configuration (CORS rules, public access settings, network rules) becomes part of your attack surface.

## Implementation notes

- **Use the SDK helpers** instead of hand-rolling signatures: the presigners in the AWS SDKs, the SAS builders in the Azure Storage client libraries, and the signed-URL functions in the Cloud Storage client libraries or `gcloud storage sign-url`.
- **Return the key with everything the client must send**: the method, any signed headers (content type, size range) and the expiry, so the client can tell an expired key from a real failure.
- **Give the bucket no public access.** For clients, the only way in should be a key.
- **Watch the storage logs** for bursts of refused requests on one object, uploads without a matching issued key, and keys used from unexpected places. On Azure, with diagnostic logging turned on, a SAS expiration policy also records every use of a SAS that exceeds it.
- **Test expiry, clock skew and retries.** The failure users notice is an upload that stops half-way, not an "access denied" on the first request.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [Private Endpoints](../private-endpoints/) — Reach managed cloud services over private IPs instead of the public internet.
- [CDN & Edge Caching](../cdn-edge-caching/) — Serve static content from edge locations close to users; only cache misses reach the origin.
- [Gatekeeper](../gatekeeper/) — A hardened broker validates and sanitises requests before they reach trusted hosts.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Event-Driven Architecture](../event-driven-architecture/) — Producers publish events to a broker; any number of consumers react on their own schedule.
- [Web-Queue-Worker](../web-queue-worker/) — A web front end hands slow work to background workers through a queue.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.

## Related components and services

- [HashiCorp Vault](../vault/) — A secrets manager: authenticate workloads, hand out short-lived credentials, encrypt data and audit every access.
- [Amazon S3](../amazon-s3/) — Object storage: objects in buckets, addressed by key, stored across Availability Zones, with storage classes, versioning and events.
- [AWS IAM](../aws-iam/) — Who may do what in AWS: principals, policies and roles that hand out temporary credentials, and how a request is evaluated.
- [Amazon Cognito](../amazon-cognito/) — Sign-up and sign-in for your app's users: user pools issue OpenID Connect tokens, identity pools trade them for AWS credentials.

## References

- [Azure Architecture Center — Valet Key pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/valet-key)
- [Microsoft Learn — Grant limited access to data with shared access signatures (SAS)](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview)
- [Microsoft Learn — Create a user delegation SAS](https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas)
- [Microsoft Learn — Define a stored access policy](https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy)
- [Amazon S3 — Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Amazon S3 — Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Amazon S3 — Browser-based uploads using POST (AWS Signature Version 4)](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-UsingHTTPPOST.html)
- [Amazon S3 — POST policy (conditions such as content-length-range)](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)
- [AWS Compute Blog — Uploading large objects to Amazon S3 using multipart upload and transfer acceleration](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/)
- [Google Cloud Storage — Signed URLs](https://docs.cloud.google.com/storage/docs/access-control/signed-urls)
- [Google Cloud Storage — Signatures (signed URLs and policy documents)](https://docs.cloud.google.com/storage/docs/authentication/signatures)
- [Amazon CloudFront — Serve private content with signed URLs and signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PrivateContent.html)
- [OWASP Cheat Sheet Series — File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
