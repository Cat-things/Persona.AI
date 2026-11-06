## What does this change?

<!-- One or two sentences. Link the issue: "Fixes #123". -->

## How was it tested?

- [ ] `uv run pytest` (backend)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` (web)
- [ ] Manually checked in the browser (dark + light, desktop + phone width) if UI changed

## Checklist

- [ ] Added or updated tests for behaviour changes
- [ ] Added an Alembic migration if models changed
- [ ] Updated `packages/shared` types if the API changed
- [ ] Updated docs if setup, config or behaviour changed
- [ ] No secrets, `.env` files or model weights committed

<!-- Screenshots for UI changes -->
