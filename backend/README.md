# Open Poll Backend

## Setup

```bash
bun install
cp .env.example .env
docker compose up -d
```

## Development

```bash
bun run dev
```

## Verification

```bash
bun run typecheck
bun test
```

## Health Endpoints

- `GET /health`
- `GET /ready`

## API Base Routes

- `/api/polls`
- `/api/responses`
- `/api/ai`

See `docs/wiki/` for architecture, API, realtime, and AI context docs.
