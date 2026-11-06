# Security policy

## Supported versions

Persona.AI is pre-1.0. Security fixes go into the latest release and the `main` branch only.
Keep your instance current with `./install.sh update`.

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report them privately through GitHub:
**Security → Report a vulnerability** on
[github.com/Cat-things/Persona.AI](https://github.com/Cat-things/Persona.AI/security/advisories/new).

Include what you can of:

- the affected version or commit and how it was installed (Docker or native);
- steps to reproduce, or a proof of concept;
- the impact you expect (data exposure, account takeover, code execution, and so on).

What to expect:

- an acknowledgement within 5 days;
- a first assessment within 14 days;
- a fix, or a mitigation plan, as soon as practical; we'll agree on a disclosure date with you;
- credit in the advisory if you'd like it.

## Scope

In scope: the server (`apps/server`), web app, mobile app, `install.sh` / `install.ps1`, and the
Docker image and compose files in this repository.

Out of scope: vulnerabilities in third-party AI backends (Ollama, ComfyUI, and so on), issues
that need an already-compromised admin account, and missing hardening on instances that were
deliberately exposed with `--lan` on untrusted networks.

## How Persona.AI protects your instance

- Passwords are hashed with argon2id. Access tokens are short-lived; refresh tokens rotate on
  every use, are stored hashed, and reuse of an old token revokes the whole session family.
- Rate limits on login, registration, chat and generation endpoints.
- CORS and WebSocket origins are locked to the configured public URL.
- Provider API keys are stored server-side only and are masked in every API response.
- Uploads are size-limited and checked by content, not file name; images are re-encoded,
  which strips metadata and neutralises polyglot files. Voice samples are kept outside the
  public media directory.
- Without a domain, the app listens on 127.0.0.1 only. Native installs run as an
  unprivileged `persona` user under hardened systemd units; containers run as a non-root user.
- The installer writes secrets to a `600`/`640` env file and never prints them.
