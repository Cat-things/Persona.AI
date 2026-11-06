# Contributing to Persona.AI

Thanks for helping. Bug reports, fixes, docs, translations and new provider adapters are all
welcome.

## Before you start

- For anything bigger than a small fix, open an issue (or comment on one) first so we can agree
  on the approach.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.
- Be kind; the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere in the project.

## Repository layout

```
apps/server     Python 3.12 + FastAPI backend, worker and CLI (package `persona`)
apps/web        React + Vite + Tailwind web app (PWA)
apps/mobile     Expo (React Native) app
packages/shared TypeScript API types and client shared by web and mobile
deploy/         Dockerfile, compose files, Caddyfile
install.sh      Linux/macOS installer; install.ps1 for Windows
docs/           User and developer documentation
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Development setup

You need [uv](https://docs.astral.sh/uv/), Node.js 22+ and pnpm.

```bash
pnpm install

# Backend, with the offline demo LLM so you don't need a model running
cd apps/server
uv sync
LLM_PROVIDER=mock SECRET_KEY=dev-secret-key-change-me ENVIRONMENT=development \
  uv run persona serve --reload
uv run persona seed-demo        # optional sample characters

# Web app (proxies /api to the backend on :8000)
cd apps/web
pnpm dev
```

More detail, including the mobile app and running against real providers:
[docs/development.md](docs/development.md).

## Checks

Run these before opening a pull request; CI runs the same ones.

```bash
# backend
cd apps/server
uv run ruff format --check persona tests
uv run ruff check persona tests
uv run pytest

# web
cd apps/web
pnpm typecheck
pnpm lint
pnpm exec prettier --check src
pnpm build
pnpm test:e2e          # Playwright smoke test (starts its own server)
```

## Pull requests

- Keep each PR focused on one change. Add or update tests for behaviour changes.
- Database changes need an Alembic migration:
  `cd apps/server && uv run persona makemigration "describe change"`, then review the file.
- API changes: update the Pydantic schemas and the mirrored types in
  `packages/shared/src/types.ts`.
- UI changes: follow [DESIGN.md](DESIGN.md) (tokens, components, motion) and check both themes
  and a phone-sized viewport. Include a screenshot in the PR.
- Don't commit secrets, `.env` files, model weights or generated media.
- Write commit messages in the imperative ("Add Piper voice listing").

## Adding an AI provider

Providers live in `apps/server/persona/services/` (`llm/`, `imagegen/`, `tts/`, `stt/`). Each is a
small async function behind a registry, uses `persona.services.http.client()` so tests can mock
HTTP, and raises `ProviderError` with a message an admin can act on. Add tests with a mocked
transport (see `tests/test_tts.py`) and document it in [docs/providers.md](docs/providers.md).

## License

By contributing you agree that your contributions are licensed under the
[AGPL-3.0](LICENSE).
