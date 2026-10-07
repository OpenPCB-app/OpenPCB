# Sign in with ChatGPT distribution boundary

The desktop build must not adopt the Sign in with ChatGPT DevKit until the owner
has approved a documented integration and redistribution route in OPENPCB-113.
This restriction does not apply to the generic credential vault or the AgentKit
migration. Connecting ChatGPT must remain an explicit additional provider choice.

## Sources and decision evidence

Recheck the official [integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt),
[SIWC documentation](https://developers.openai.com/siwc), and
[token sharing and open source guidance](https://developers.openai.com/siwc/token-sharing-open-source)
before implementing authentication. Service access terms and the license to copy
and redistribute SDK code are separate questions.

The [service terms](https://openai.com/policies/sign-in-with-chatgpt-terms/), dated
29 September 2026 and checked 6 October 2026, require the app's own identity,
supported user-authorized token acquisition, user-controlled local persistent
token storage, and free access to the connected user's eligible plan. They prohibit
account pooling and limit evasion. They also restrict modification and sublicensing
of SIWC software. An SDK extension therefore needs explicit clarification of its
permission, separately from technical feasibility. Branding must follow the
authorized names, logos, and buttons without suggesting endorsement.

The reviewed DevKit source is
[`f723814abdccec135b519c451fb6e1992ee5e933`](https://github.com/openai/sign-in-with-chatgpt-devkit/tree/f723814abdccec135b519c451fb6e1992ee5e933).
Its [license](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/f723814abdccec135b519c451fb6e1992ee5e933/LICENSE)
is the OpenAI Noncommercial License 1.0, not a permissive software license. The
commercial-purpose restrictions include anticipated commercial application or
business advantage; a zero-price desktop application is not sufficient evidence
of permission. The license describes separate written commercial rights and
redistribution conditions. This document does not certify legal compatibility.

The proposed decision is to obtain written confirmation of the authentication,
redistribution, and commercial-use route before incorporating DevKit code. An
independently authored implementation of the documented protocol is an alternative
only after its supported authentication and service-access route is confirmed; it
must not copy restricted implementation code or assume that avoiding an SDK grants
access. Record the approved route, approving owner, source/license revision, and
applicable redistribution notices in OPENPCB-113 before adoption.

OpenPCB's repository license is AGPL-3.0; AgentKit source at
`35ba1c262f9c1ec567066224a71a942c38d199a9` carries MIT terms, including preservation
of its copyright and license notice. Neither license grants rights to relicense
the restricted DevKit. The relationship between AGPL redistribution, DevKit
conditions, and OpenPCB's planned separate paid cloud services remains a question
for qualified review. Proposed delivery is a local macOS desktop bundle, not a
managed inference service. No DevKit package/version is selected for that bundle.

On 6 October 2026, `npm view @siwc/local version --json` and
`npm view @siwc/react version --json` both returned `E404`; documentation examples
are not evidence of an installable registry release. Developer adoption and
redistribution both remain unapproved until the explicit route decision; generic
vault and mock transport development can proceed independently.

## Build guard

`npm run check:siwc-distribution` scans workspace manifests and the npm lockfile
for direct, aliased, and transitive `@siwc/*` or DevKit dependencies. Root and
Electron builds run this check. Tests use:

```sh
node --test scripts/check-siwc-distribution.test.mjs
```

The guard detects dependency references, not copied source, all possible aliases,
or legal compliance. It does not authorize distribution when it passes. Do not
remove it merely because mock Responses tests pass. An approved adoption change
must replace it with checks for the selected package, license, notices, and
feature gate. No SIWC authentication dependency or live-account inference is
required for migration qualification.

## Transport requirements

The supported application path is a local Responses provider through AgentKit to
native tools. Follow the official [model and inference contract](https://developers.openai.com/siwc/models-and-inference),
including account-specific model availability, public Responses inference,
`store: false`, streaming, and tool-call/result identity. A text-only SDK example
does not qualify tool execution. Never use private endpoints, another application's
tokens, an automatic API-key fallback, or account rotation after failure.

Gate B additionally needs the approved distribution route and owner-authorized
live-account evidence. Mock transport tests and an unpackaged Electron credential
test cannot substitute for either release gate.
