# RequestCapsule Privacy Notice

Last updated: July 10, 2026

RequestCapsule is a local-first Chrome DevTools extension.

## Data processed

When the RequestCapsule DevTools panel is open, the extension can process request metadata and content made available by Chrome DevTools, including:

- request URLs;
- HTTP methods and status codes;
- request and response headers;
- query parameters;
- request bodies;
- response bodies;
- timing and size information.

Response content is retrieved only after the user selects a request.

## Local processing

Captured request data is processed within the browser profile. RequestCapsule does not transmit captured URLs, headers, bodies, fixtures, generated code, or generated ZIP files to a backend.

The extension contains no third-party analytics, advertising SDK, crash-reporting SDK, remote feature flags, remote fonts, or remote executable code.

## Redaction

Before generation, RequestCapsule permanently removes common authentication headers, cookies, bearer tokens, JWT-like values, private-key blocks, and known provider credential patterns from its serializable model.

It also flags likely personal or identifying values for optional redaction.

Automated redaction cannot guarantee detection of every sensitive value. Users must review generated artifacts before sharing them.

## Storage

Captured data is not persisted by default.

The user may explicitly save a sanitized capture locally. Saved captures are stored in extension-controlled IndexedDB and contain only the already-sanitized request model.

The extension may also store:

- onboarding completion;
- UI preferences;
- redaction rules;
- a verified signed entitlement;
- validation feedback entered by the user.

Validation feedback is copied manually. It is not transmitted automatically and deliberately excludes URLs, hostnames, request bodies, response bodies, and credentials.

## Request replay

RequestCapsule never replays captured requests.

## Licensing

The validation build verifies signed entitlement files locally using a packaged public key. The extension does not contact a runtime license-validation endpoint.

A future entitlement-issuance service may process an opaque purchase or license identifier. It must not receive captured browser traffic.

## Deletion

Users can delete saved captures and local extension data from the extension interface. Uninstalling the extension removes extension-controlled local storage according to browser behavior.

Downloaded artifacts are ordinary local files and remain the user's responsibility.

## Contact

Support URL placeholder: `https://requestcapsule.dev/support`

Privacy contact placeholder: `privacy@requestcapsule.dev`
