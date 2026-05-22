# Security Policy

## Supported versions

Only the latest `v0.x.y-beta` release is supported during the public beta. Once `v1.0.0` ships, this policy will be revised.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email **security@openpcb.app** with:

- A clear description of the issue and its impact
- Steps to reproduce (and a proof of concept if possible)
- The affected OpenPCB version (`Help → About`) and platform

You can also use [GitHub Security Advisories](https://github.com/OpenPCB-app/OpenPCB/security/advisories/new) for private disclosure.

## What to expect

- Acknowledgement within 72 hours
- A coordinated disclosure timeline (typically 90 days, shorter if a fix is straightforward)
- Credit in the release notes if you'd like (and have not opted out)

## Scope

In scope:

- The OpenPCB desktop application (Electron shell + Bun backend + React frontend)
- The `.opclib` import path (archive handling, schema validation)
- The local HTTP backend on `127.0.0.1` (when reachable from other processes on the host)

Out of scope:

- Issues requiring physical access to an unlocked machine
- Vulnerabilities in third-party dependencies that have no exploitable path in OpenPCB
- Bugs in `Cloud/` services (handled separately; not part of public release)
