<!-- BEGIN GENERATED: header (npm run sync; do not edit by hand) -->
[Catalog](../../README.md#contents) › [🔐 Identity & Access (Auth)](../../README.md#identity--access-auth)

# Device Authorization Grant

> Sign in on a TV or CLI by approving a short code on your phone.

<p align="center"><img src="diagram.svg" alt="Animated diagram: Device Authorization Grant" width="100%"></p>
<p align="center"><a href="https://varapul.github.io/TechSolutions/device-authorization-grant.html"><b>▶ Step through it one step at a time</b></a> in the interactive player</p>

| Step | What happens |
|---|---|
| **1 · Ask for a code** | The TV app is a public client, so it sends only its `client_id` and the `scope` it wants to the **device authorization endpoint**. The server stores a pending request and answers with a long, random `device_code` that the TV keeps to itself, a short `user_code` (WDJB-MJHT), the `verification_uri`, an optional `verification_uri_complete` for a QR code, `expires_in` (900 s here) and the polling `interval` (5 s). The TV tells the user where to go and which code to enter. |
| **2 · Approve on the phone** | The user opens example.com/device on their phone and enters WDJB-MJHT (scanning the QR code, which carries `verification_uri_complete`, skips the typing), then signs in the usual way, including MFA. The consent screen names the app and the device, and tells the user to allow it only if they started this on a TV in front of them. They tap **Allow** and the request is marked approved; the password and the second factor went only to the authorization server, never to the TV. |
| **3 · The TV polls** | From the start, the TV polls the **token endpoint** with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and its `device_code`, waiting `interval` seconds between polls. While the request is pending the answer is `authorization_pending`; a poll that comes too soon gets `slow_down`, and the TV adds 5 s to its interval for good. The first poll after approval returns an access token and a refresh token, and the TV shows the user's library. |
| **4 · Other endings, phishing** | If the user taps Deny the next poll returns `access_denied`; if nobody approves within `expires_in`, it returns `expired_token`, and the TV gets a new code only when the user asks for one. The risk this flow adds is **remote phishing**: an attacker starts a flow on their own device and sends the code to a victim with a pretext, and if the victim approves, the attacker's device receives the tokens. Defences: a consent screen that names the app and the device and warns, a short expiry, rate limits on code entry, and enabling the grant only for clients that need it. |
<!-- END GENERATED: header -->

## The problem

A smart TV app, a game console or a command-line tool needs to call an API on a user's behalf. The usual answer, the authorization code flow, sends the user to a browser on the same device and redirects back to the app. That breaks down when the device has no usable browser, or when the only keyboard is a remote control: typing an email address, a long password and a one-time code letter by letter is miserable, and it hands the password to the device. A CLI in an SSH session has a keyboard but no browser on the machine that runs it. What these devices do have is a screen (or some other way to show a short code) and an outbound connection to the internet, and their user nearly always has a phone within reach.

## How it works

The OAuth 2.0 Device Authorization Grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628), usually called the *device code flow*) splits sign-in across two devices: the device that wants the tokens, and a second device with a real browser where the user signs in.

1. **Device authorization request.** The device posts its `client_id` and the `scope` it wants to the authorization server's *device authorization endpoint*. A device can't keep a client secret (whoever owns it can extract one), so it is normally a public client and sends no secret (RFC 8628 §5.6).
2. **Device authorization response.** The server stores a pending request and returns `device_code` (a long, random value the device keeps to itself and never displays), `user_code` (short, for a person to type), `verification_uri` (short and easy to type), optionally `verification_uri_complete` (the same address with the code already in it, for a QR code or NFC), `expires_in` (how long both codes live) and optionally `interval` (the minimum gap between polls, **5 seconds when the server leaves it out**).
3. **User interaction.** The device shows the address and the code. On their phone or laptop the user opens the address, signs in the way they always do (passkey, password, MFA, a federated login), enters the code, sees what they are authorizing, and approves or denies. The device never handles a credential.
4. **Polling.** Meanwhile the device calls the *token endpoint* with `grant_type=urn:ietf:params:oauth:grant-type:device_code` and its `device_code`, waiting at least `interval` seconds before each call. Nothing is redirected back to the device: the protocol assumes the phone has no way to reach it, so polling is how the device learns the outcome. Until there is one, the token endpoint answers with one of four errors:
   - `authorization_pending`: no decision yet, poll again.
   - `slow_down`: still pending, and the device is polling too fast. It must add 5 seconds to its interval for this request and every later one.
   - `access_denied`: the user declined. Stop.
   - `expired_token`: `expires_in` has passed. Stop, and start a new flow only when the user asks for one.

   Any other error also ends the polling. After a connection timeout the device must poll less often, for example by doubling its interval.
5. **Tokens.** After the user approves, the next poll gets an ordinary token response: an access token, usually a refresh token, and an ID token when the device asked for the `openid` scope.

A server that publishes OAuth metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) can announce the grant there: a `device_authorization_endpoint`, and the grant type URN under `grant_types_supported`.

## When to use it

- **A screen without a good keyboard or browser:** smart TVs, streaming sticks, consoles, set-top boxes, smart displays, printers and kiosks.
- **Command-line tools in headless sessions:** a CLI over SSH, in a container or on a jump host, with a person at the other end. `gh auth login` (its browser login shows a one-time device code to enter on github.com) and `az login --use-device-code` are familiar examples.
- **Not when the device has a usable browser.** Use [Authorization Code + PKCE](../oauth2-authorization-code-pkce/), which keeps sign-in on the same device and avoids the phishing problem below. On macOS and Linux, for example, Azure CLI opens the browser for an authorization code sign-in when it can and falls back to the device code flow only when it can't.
- **Not when there is no user.** Service-to-service calls use [Client Credentials](../oauth2-client-credentials/).
- **Not for high-value access you can't otherwise protect.** The IETF's best current practice for cross-device flows ([RFC 10027](https://www.rfc-editor.org/rfc/rfc10027), BCP 247, published August 2026) says to use this grant only when the stronger cross-device options aren't possible, to avoid it for sensitive or business-critical resources, and always to add mitigations such as proximity checks or pre-registered devices. It also says not to use cross-device flows at all when both "devices" are the same one.

## Trade-offs

- **Remote phishing comes with the design.** Nothing links the person who approves to the screen that shows the code. An attacker can start a flow on their own device and send its user code to a victim with a pretext ("enter this code to keep your account"); if the victim signs in and approves, the tokens go to the attacker's device. RFC 8628 §5.4 describes the attack, and it happens in practice: in February 2025 Microsoft reported a campaign by a group it tracks as Storm-2372, running since August 2024, whose fake Microsoft Teams invitations used an attacker's device code as the "meeting ID".
- **Short codes can be guessed.** A user code is short so that people can type it, so expiry and rate limits are what stop brute force (see the notes below).
- **QR codes trade safety for convenience.** `verification_uri_complete` saves typing, but a link that already carries the code is even easier to send to a victim. The server should still show the code and ask the user to check that it matches the screen in front of them.
- **The approving device is not the device that gets the tokens.** Device compliance, location and risk signals from the phone's session say little about the TV (RFC 8628 §5.3), so policies built on them don't protect it.
- **Someone in the room can get there first.** Anyone who can see the screen can enter the code before the owner does and attach the device to their own account (session spying, §5.5).
- **Polling costs capacity.** Every waiting device calls the token endpoint every few seconds; `interval` and `slow_down` are the server's controls.
- **The client can't prove who it is.** Any software can present a public client's `client_id`, so a consent screen that names the app doesn't prove the app is genuine.

## Implementation notes

- **User codes** (RFC 8628 §6.1): the RFC suggests 8 characters from the 20 consonants `BCDFGHJKLMNPQRSTVWXZ` (no vowels, so a code can't spell a word), shown with a dash for readability as in `WDJB-MJHT`: 20⁸ combinations, about 34.5 bits. Where people don't use A–Z keyboards, 9 digits work too (`019-450-730`, 10⁹). Uppercase the input before comparing, strip dashes and anything outside the character set, and avoid character sets with look-alikes such as 0 and O, or 1, l and I. Rate-limit code entry: §5.1 works out that with an 8-character code like this, the rate limit and lifetime together should allow only about 5 guesses to hold an attacker's chance near 1 in 2³². GitHub, for one, accepts 50 code submissions per hour per app. The `device_code` is never typed, so make it long and random (§5.2).
- **Consent screen:** name the client and the kind of device, say where the request came from, tell the user to continue only if they started this on a device in front of them, and give Deny at least as much prominence as Allow (RFC 10027 §6.1.14).
- **Phishing defences** (RFC 10027): assess the risk first; establish proximity where you can (same network, geolocation, Bluetooth); keep codes short-lived and limited to one use; rate-limit; keep scopes narrow and tokens short-lived; sender-constrain tokens.
- **Turn the grant on only for clients that need it.** GitHub makes each app enable the device flow, Google requires a separate client type for it, and Microsoft Entra ID's Conditional Access has an *authentication flows* condition that blocks it. Microsoft recommends blocking the device code flow wherever it isn't needed.
- **Client behaviour:** start a flow only when the user asks for one, not when the app starts or after a failure (§3.1); honour `interval` and `slow_down`; back off after timeouts; stop on any other error.
- **Tokens on the device:** keep the refresh token in the platform's secure storage, such as a keychain, keystore or the OS credential store (`gh` uses the system credential store and falls back to a plain-text file only when it can't use one). RFC 9700 requires refresh tokens for public clients to be sender-constrained or rotated on every use: see [Refresh Token Rotation](../refresh-token-rotation/). If the device also needs to know who signed in, request `openid` and validate the ID token ([OpenID Connect](../openid-connect/)). Give each device its own grant, so that one TV can be signed out without signing the user out everywhere: the app revokes its own tokens on sign-out ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)), and the user or an admin can revoke that grant on the server. [Sessions vs Tokens](../sessions-vs-tokens/) covers what revocation can and can't reach.
- **Vendor differences** (checked October 2026):
  - *Microsoft Entra ID*: the endpoint is `/oauth2/v2.0/devicecode`; codes last 15 minutes by default; `verification_uri_complete` isn't supported; a declined request returns `authorization_declined` instead of `access_denied`; a refresh token comes back only when `offline_access` is in the scope.
  - *Google*: needs an OAuth client of the "TVs and Limited Input devices" type and allows only a short list of scopes (`openid`, `email`, `profile`, two Drive scopes and two YouTube scopes). The response calls the address `verification_url` (`https://www.google.com/device`), the user code is documented as case-sensitive and must be shown exactly as returned, and pending and `slow_down` answers come with HTTP 428 and 403, so read the `error` field rather than the status code.
  - *GitHub*: the device flow must be enabled in the app's settings; users enter an 8-character code at `https://github.com/login/device` within 15 minutes; `slow_down` adds 5 seconds; no client secret is needed.
- **Stronger cross-device options.** RFC 10027 ranks FIDO cross-device authentication (a phone acting as a passkey authenticator, with proximity proven over Bluetooth) as the best protection, and notes it can be paired with the authorization code flow and PKCE to sign in a TV without the risks of this grant. When that isn't available, it points to **CIBA** ([OpenID Connect Client-Initiated Backchannel Authentication Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html), a final OpenID Foundation specification since September 2021): the device identifies the user, the provider contacts the user's registered device directly (a push notification, for example), and the device collects the tokens by poll, ping or push. With no code to pass along, CIBA is harder to phish, but someone who knows or guesses the user's identifier can still trigger requests.

<!-- BEGIN GENERATED: footer (npm run sync; do not edit by hand) -->
## Related patterns

- [OAuth 2.0 Authorization Code + PKCE](../oauth2-authorization-code-pkce/) — The standard sign-in flow for web, mobile and single-page apps: code via the browser, tokens via the back channel.
- [OpenID Connect (OIDC)](../openid-connect/) — An ID token on top of OAuth 2.0 tells the app who signed in.
- [Refresh Token Rotation](../refresh-token-rotation/) — Short-lived access tokens, single-use refresh tokens, and reuse detection that revokes the whole family.
- [OAuth 2.0 Client Credentials](../oauth2-client-credentials/) — Machine-to-machine access tokens, with no user involved.
- [Sessions vs Tokens](../sessions-vs-tokens/) — Server-side sessions versus self-contained tokens: where the state lives and how you revoke it.
- [JWT Validation](../jwt-validation/) — APIs verify token signatures and claims locally, using the issuer's cached public keys (JWKS).
- [Federated Identity](../federated-identity/) — Let an external identity provider authenticate users; the application trusts its tokens.
- [Zero Trust Access](../zero-trust-access/) — No implicit trust from network location: verify identity, device and context on every request.

## References

- [RFC 8628 — OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628)
- [RFC 10027 (BCP 247) — Best Current Practice for Security of Cross-Device Flows](https://www.rfc-editor.org/rfc/rfc10027)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [Microsoft identity platform — OAuth 2.0 device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)
- [Microsoft Entra — Conditional Access: Authentication flows](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-authentication-flows)
- [Google for Developers — OAuth 2.0 for TV and Limited-Input Device Applications](https://developers.google.com/identity/protocols/oauth2/limited-input-device)
- [GitHub Docs — Authorizing OAuth apps (device flow)](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- [OpenID Connect Client-Initiated Backchannel Authentication (CIBA) Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html)
- [Microsoft Security Blog — Storm-2372 conducts device code phishing campaign](https://www.microsoft.com/en-us/security/blog/2025/02/13/storm-2372-conducts-device-code-phishing-campaign/)

---

[← Back to the catalog](../../README.md#contents)
<!-- END GENERATED: footer -->
