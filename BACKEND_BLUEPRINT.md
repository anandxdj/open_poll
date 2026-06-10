# Backend Blueprint — Modular Domain-First Bun/Express API

> A complete, copy-paste reference for replicating this backend's **folder structure,
> conventions, shared (`src/common`) code, module (`src/modules`) anatomy, and the
> LLM-wiki / context-router system** for a *different* backend domain.
>
> The reference implementation is an "Open Poll" platform. To build another backend,
> keep everything in **Part A–E and G–H verbatim** (the skeleton), and swap only the
> **domain modules** described in Part F.

---

## Table of Contents

1. [Part A — Philosophy & Tech Stack](#part-a--philosophy--tech-stack)
2. [Part B — Complete Folder Structure](#part-b--complete-folder-structure)
3. [Part C — Every Command](#part-c--every-command)
4. [Part D — Root & Config Files (full content)](#part-d--root--config-files-full-content)
5. [Part E — `src/common` (full code, replicate verbatim)](#part-e--srccommon-full-code-replicate-verbatim)
6. [Part F — `src/modules` (anatomy + full code)](#part-f--srcmodules-anatomy--full-code)
7. [Part G — The LLM-Wiki / Context-Router System](#part-g--the-llm-wiki--context-router-system)
8. [Part H — Cross-Cutting Patterns](#part-h--cross-cutting-patterns)
9. [Part I — Replication Checklist for a New Backend](#part-i--replication-checklist-for-a-new-backend)

---

## Part A — Philosophy & Tech Stack

### Core idea
**Modular, domain-first.** Each business domain is a self-contained folder under
`src/modules/<domain>/`. Shared plumbing lives in `src/common/`. There is no "controllers/"
or "services/" top-level folder — code is grouped by *feature*, not by *layer*.

### Request flow (memorize this)
```
HTTP  : route → validate(Zod) → controller → service → model
Error : service/controller throws ApiError → global errorHandler
Realtime: state change → Redis publish → Redis subscriber → Socket.io room emit
```

### Layer responsibilities
| Layer        | File              | Owns                                                        |
|--------------|-------------------|-------------------------------------------------------------|
| Route        | `*.route.ts`      | Path → middleware chain → controller binding                |
| Validation   | `*.schema.ts`     | Zod request schemas + inferred TS types                     |
| Controller   | `*.controller.ts` | `req`/`res` only; delegate to service; `next(error)`        |
| Service      | `*.service.ts`    | All business rules + DB access; throws `ApiError`           |
| Model        | `*.model.ts`      | Mongoose schema + TS interface                              |

### Tech stack
| Concern        | Choice                                              |
|----------------|-----------------------------------------------------|
| Runtime        | **Bun** (not Node/npm/pnpm)                          |
| HTTP framework | Express 5                                           |
| Language       | TypeScript (strict, ESNext, bundler resolution)     |
| DB             | MongoDB via Mongoose                                |
| Cache / PubSub | Redis (`redis` client)                              |
| Realtime       | Socket.io                                           |
| Validation     | Zod                                                 |
| Auth           | JWT (access + refresh) + Google OAuth + bcrypt      |
| Email          | Resend (with mock fallback)                         |
| AI (optional)  | LangChain + LangGraph + Google Gemini               |
| Container      | Docker (`oven/bun` base) + docker-compose + Traefik |

---

## Part B — Complete Folder Structure

```
<repo-root>/
├── .cursor/                          # LLM-wiki engine (see Part G)
│   ├── hooks.json                    # registers beforeSubmitPrompt hook
│   ├── hooks/
│   │   └── log-chat-prompt.mjs       # auto-appends each prompt to chat-log.md
│   ├── rules/
│   │   ├── llm-context-router.mdc    # always-on: load minimal wiki context
│   │   └── use-bun.mdc               # always-on: prefer Bun over npm
│   └── settings.json
├── .gitignore
├── docker-compose.yml                # redis + backend behind Traefik
├── docker.ps1                        # Windows helper to bring stack up
├── README.md
└── backend/
    ├── .dockerignore
    ├── .env                          # (gitignored — real secrets)
    ├── .env.example                  # template of every env var
    ├── .gitignore
    ├── Dockerfile                    # oven/bun image, healthcheck on :8080
    ├── bun.lock
    ├── package.json
    ├── tsconfig.json
    ├── index.ts                      # placeholder entry (real entry = src/app.ts)
    ├── README.md
    ├── docs/
    │   └── wiki/                      # the "LLM wiki" — see Part G
    │       ├── context-router.md      # READ FIRST: maps task → docs
    │       ├── project-overview.md
    │       ├── backend-architecture.md
    │       ├── api-conventions.md
    │       ├── how-to-run-limited-context.md
    │       ├── decision-log.md
    │       ├── mvp-checklist.md
    │       ├── chat-log.md            # auto-appended by the hook
    │       ├── modules/
    │       │   ├── polls.md
    │       │   ├── responses.md
    │       │   └── ai.md
    │       ├── api/
    │       │   ├── polls.md
    │       │   └── responses.md
    │       ├── realtime/
    │       │   ├── socket-events.md
    │       │   └── redis-channels.md
    │       ├── ai/
    │       │   ├── prompting-and-graph-flow.md
    │       │   └── structured-output-contract.md
    │       └── setup/
    │           └── local-dev.md
    ├── scratch/
    │   └── check_imports.js           # dev-only: scan for missing imports
    ├── tests/
    │   ├── mvp.smoke.test.ts          # service-level smoke tests (mocked models)
    │   └── ai.contract.test.ts        # Zod contract test
    └── src/
        ├── app.ts                     # REAL entry: express + http + socket + bootstrap
        ├── common/                    # shared plumbing — replicate verbatim (Part E)
        │   ├── config/
        │   │   ├── db.ts              # mongoose connect
        │   │   ├── redis.ts           # redis client + connect
        │   │   └── email.ts           # Resend wrapper + templates
        │   ├── middlewares/
        │   │   ├── errorHandler.ts    # global error → JSON
        │   │   └── validate.middleware.ts  # Zod body validator
        │   ├── realtime/
        │   │   ├── events.ts          # channel/event name constants + payload types
        │   │   ├── socket.ts          # setupSocketAndPubSub (Redis sub → socket emit)
        │   │   └── socket.gateway.ts  # alt gateway helper (init + emit)
        │   └── utils/
        │       ├── ApiError.ts        # typed HTTP error class + factory statics
        │       ├── ApiResponse.ts     # standardized success responses
        │       └── jwt.utils.ts       # access/refresh sign+verify, reset/hash tokens
        └── modules/                   # one folder per domain — swap these (Part F)
            ├── auth/
            │   ├── auth.route.ts
            │   ├── auth.controller.ts
            │   ├── auth.service.ts
            │   ├── auth.model.ts
            │   ├── auth.middleware.ts # authenticate() + authorize()
            │   └── dto/
            │       ├── register.schema.ts
            │       ├── login.schema.ts
            │       ├── forgot-password.schema.ts
            │       └── reset-password.schema.ts
            ├── polls/                  # DOMAIN module (example)
            │   ├── polls.route.ts
            │   ├── polls.controller.ts
            │   ├── polls.service.ts
            │   ├── polls.model.ts
            │   └── polls.schema.ts
            ├── responses/              # DOMAIN module + background worker
            │   ├── responses.route.ts
            │   ├── responses.controller.ts
            │   ├── responses.service.ts
            │   ├── responses.model.ts
            │   ├── responses.schema.ts
            │   ├── analytics.model.ts  # secondary aggregate model
            │   └── analytics.worker.ts # setInterval write-behind flush
            └── ai/                     # OPTIONAL module (LangGraph)
                ├── ai.route.ts
                ├── ai.controller.ts
                ├── ai.service.ts
                └── ai.schema.ts
```

**Naming convention:** every file is `<module>.<layer>.ts`. Auth keeps its Zod schemas
in a `dto/` subfolder; domain modules keep a single `<module>.schema.ts`. Either pattern is
fine — pick one and stay consistent.

---

## Part C — Every Command

All commands run from `backend/` unless noted. **Use Bun, never npm.**

### Install & bootstrap
```bash
bun install                 # install deps from package.json / bun.lock
cp .env.example .env        # then fill in real values
```

### Local services (from repo root)
```bash
docker compose up -d        # start redis (+ backend container)
# OR on Windows:
./docker.ps1                # build + up -d, prints URLs
```

### Develop
```bash
bun run dev                 # bun --watch run src/app.ts  (hot reload)
```

### Run (production-style)
```bash
bun run start               # bun src/app.ts
```

### Verify
```bash
bun run typecheck           # bun x tsc --noEmit  (no emit, strict check)
bun run build               # alias → typecheck (no bundling needed for Bun)
bun test                    # run tests/*.test.ts via bun:test
```

### Dev-only utility
```bash
bun scratch/check_imports.js   # scan src/ for files using ApiError without importing it
```

### Health (after server up)
```bash
curl http://localhost:5000/health   # process up?
curl http://localhost:5000/ready    # Mongo + Redis ready?
```

### Docker (full container build)
```bash
docker compose up --build -d
docker compose logs -f openpoll-backend
docker compose down
```

---

## Part D — Root & Config Files (full content)

### `backend/package.json`
```json
{
  "name": "backend",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun --watch run src/app.ts",
    "build": "bun run typecheck",
    "start": "bun src/app.ts",
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit"
  },
  "devDependencies": {
    "@types/bcryptjs": "^3.0.0",
    "@types/bun": "latest",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^25.6.2",
    "typescript": "^5"
  },
  "dependencies": {
    "@langchain/core": "^1.1.45",
    "@langchain/google-genai": "^2.1.30",
    "@langchain/langgraph": "^1.3.0",
    "@types/cookie-parser": "^1.4.10",
    "axios": "^1.16.1",
    "bcryptjs": "^3.0.3",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "langchain": "^1.4.0",
    "mongoose": "^9.6.2",
    "openid-client": "^6.8.4",
    "redis": "^5.12.1",
    "resend": "^6.12.3",
    "socket.io": "^4.8.3",
    "zod": "^4.4.3"
  }
}
```
> For a non-AI backend, drop `@langchain/*`, `langchain`. For password-less, drop `bcryptjs`.

### `backend/tsconfig.json`
```json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false,
    "types": ["node", "bun"]
  }
}
```
> `verbatimModuleSyntax: true` → you must `import type { ... }` for type-only imports.

### `backend/index.ts` (placeholder)
```ts
console.log("Hello via Bun!");
```
> Not the real entry. `package.json` scripts point at `src/app.ts`. Kept only because Bun
> scaffolds it. The real bootstrap lives in `src/app.ts` (Part E).

### `backend/Dockerfile`
```dockerfile
# Use the official Bun image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy app source
COPY . .

# Expose backend port
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

# Start app
CMD ["bun", "run", "start"]
```
> Note the container healthcheck hits `:8080`, but the app defaults to `PORT=5000`. In
> production set `PORT=8080` (or align both). Compose injects `NODE_ENV=production`.

### `backend/.dockerignore`
```
node_modules
dist
.env
.git
.gitignore
*.md
docker-compose.yml
Dockerfile
.dockerignore
bun.lockb
.next
out
```

### `backend/.gitignore`
```
# dependencies (bun install)
node_modules

# output
out
dist
*.tgz

# code coverage
coverage
*.lcov

# logs
logs
_.log
report.[0-9]_.[0-9]_.[0-9]_.[0-9]_.json

# dotenv environment variable files
.env
.env.development.local
.env.test.local
.env.production.local
.env.local

# caches
.eslintcache
.cache
*.tsbuildinfo

# IntelliJ based IDEs
.idea

# Finder (MacOS) folder config
.DS_Store

package-lock.json
```

### `backend/.env.example`
```dotenv
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/open-poll-platform
REDIS_URL=redis://127.0.0.1:6379
GEMINI_API_KEY=your_gemini_api_key

# App URLs
# The URL of your Next.js frontend (e.g., https://openpoll.anands.dev)
FRONTEND_URL=http://localhost:3000

# Auth Secrets (change in production)
JWT_SECRET=replace_with_a_long_random_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
# Must match the URL registered in Google Console
# Example: https://openpoll-backend.anands.dev/api/auth/google/callback
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Email (Resend)
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_NAME="OpenPoll"
RESEND_FROM_EMAIL=onboarding@resend.dev
```

### `docker-compose.yml` (repo root)
```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: openpoll-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    networks:
      - traefik

  openpoll-backend:
    build:
      context: ./backend
    container_name: openpoll-backend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.openpoll-backend.rule=Host(`openpoll-backend.anands.dev`)"
      - "traefik.http.routers.openpoll-backend.entrypoints=websecure"
      - "traefik.http.routers.openpoll-backend.tls.certresolver=letsencrypt"
      - "traefik.http.services.openpoll-backend.loadbalancer.server.port=8080"
      - "traefik.docker.network=traefik"

networks:
  traefik:
    external: true

volumes:
  redis_data:
```
> MongoDB is **not** in compose — this stack uses a remote Atlas instance (`MONGO_URI`).
> Add a `mongo` service if you want it local. Traefik labels assume an external `traefik`
> network/reverse-proxy; drop them for plain local use.

### `docker.ps1` (Windows helper, repo root)
```powershell
# docker.ps1 - Helper script to run the Docker environment
Write-Host "Starting Open Poll Docker environment..." -ForegroundColor Cyan

# Check if docker-compose is installed
if (!(Get-Command "docker-compose" -ErrorAction SilentlyContinue)) {
    Write-Error "docker-compose is not installed. Please install Docker Desktop or docker-compose."
    exit
}

# Run docker-compose up with build
docker-compose up --build -d

Write-Host "Backend services are starting up!" -ForegroundColor Green
Write-Host "Backend: http://localhost:5000"
Write-Host "Redis: localhost:6379"
Write-Host "MongoDB: Remote Atlas Instance"
```

### `backend/README.md`
```markdown
# Open Poll Backend

## Setup
\`\`\`bash
bun install
cp .env.example .env
docker compose up -d
\`\`\`

## Development
\`\`\`bash
bun run dev
\`\`\`

## Verification
\`\`\`bash
bun run typecheck
bun test
\`\`\`

## Health Endpoints
- `GET /health`
- `GET /ready`

## API Base Routes
- `/api/polls`
- `/api/responses`
- `/api/ai`

See `docs/wiki/` for architecture, API, realtime, and AI context docs.
```

---

## Part E — `src/common` (full code, replicate verbatim)

This entire folder is domain-agnostic. Copy it to any new backend unchanged (rename log
prefixes/emoji to taste).

### `src/app.ts` — application entry & bootstrap
```ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { connectDB } from './common/config/db';
import { connectRedis } from './common/config/redis';
import pollsRouter from './modules/polls/polls.route';
import responsesRouter from './modules/responses/responses.route';
import aiRouter from './modules/ai/ai.route';
import { errorHandler } from './common/middlewares/errorHandler';
import mongoose from 'mongoose';
import { redisClient } from './common/config/redis';
import { setupSocketAndPubSub } from './common/realtime/socket';
import { startAnalyticsWorker } from './modules/responses/analytics.worker';
import cookieParser from 'cookie-parser';
import authRouter from './modules/auth/auth.route';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Global Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Healthcheck Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'AI Poll Platform is running 🥟' });
});

app.get('/ready', (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const redisReady = redisClient.isOpen;

  if (!mongoReady || !redisReady) {
    return res.status(503).json({
      status: 'NOT_READY',
      services: { mongodb: mongoReady, redis: redisReady },
    });
  }

  return res.status(200).json({
    status: 'READY',
    services: { mongodb: mongoReady, redis: redisReady },
  });
});

// Bridge Route: Catch OAuth redirects that hit the backend root and forward to frontend
app.get('/auth/callback', (req, res) => {
  const { token } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (!token) {
    return res.redirect(`${frontendUrl}/login?error=Missing token`);
  }

  console.log(`[Auth] Bridging callback for token: ${String(token).substring(0, 10)}...`);
  res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
});

app.use('/api/auth', authRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/responses', responsesRouter);
app.use('/api/ai', aiRouter);
app.use(errorHandler);   // <-- MUST be registered AFTER all routes

// Boot Server & Connect Services
const PORT = process.env.PORT || 5000;
const bootstrap = async () => {
  await connectDB();
  await connectRedis();
  await setupSocketAndPubSub(io);
  startAnalyticsWorker();

  httpServer.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
  });
};

void bootstrap();
```
**Bootstrap order matters:** DB → Redis → Socket/PubSub → background worker → listen.
`errorHandler` is registered **last** so it catches everything routed before it.

### `src/common/config/db.ts`
```ts
import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error("MONGO_URI is missing in .env file");
    }

    const conn = await mongoose.connect(mongoURI);
    console.log(`[MongoDB] Connected: ${conn.connection.host} 🍃`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error:`, error);
    process.exit(1);   // fail fast on boot
  }
};
```

### `src/common/config/redis.ts`
```ts
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
console.log(`[Redis] Connecting to: ${redisUrl}`);

export const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (err) => console.error('[Redis] Client Error:', err));
redisClient.on('connect', () => console.log('[Redis] Connected successfully ⚡'));

export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error(`[Redis] Connection Error:`, error);
  }
};
```
> One shared `redisClient` for normal commands. The **subscriber** is a separate client
> (created in `socket.ts`) — Redis requires a dedicated connection for SUBSCRIBE mode.

### `src/common/config/email.ts`
```ts
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: `"${process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME}" <${process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
      });

      if (error) {
        throw new Error(error.message);
      }
      return data;
    } else {
      // Fallback to mock log if no API key is provided
      console.log(`[Email Mock] To: ${to}, Subject: ${subject}`);
    }
  } catch (error: any) {
    console.error(`[Email Error] Failed to send email to ${to}:`, error.message);
  }
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${token}`;
  await sendEmail(
    email,
    'Verify your email - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Welcome to OpenPoll!</h2>
      <p>Thank you for signing up. Please click the button below to verify your email address:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${url}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">If you didn't create an account, you can safely ignore this email.</p>
    </div>
    `
  );
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;
  await sendEmail(
    email,
    'Reset your password - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Password Reset Request</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
      </div>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">OpenPoll Platform</p>
    </div>
    `
  );
};
```
> **Pattern:** if no API key, log instead of throwing. Lets the app run in dev with zero
> email config. Generalize `sendEmail(to, subject, html)` and add domain-specific templates.

### `src/common/middlewares/errorHandler.ts`
```ts
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  console.error(`[Unhandled Error]`, err);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error'
  });
};
```
> Known `ApiError` → its status + message. Anything else → logged + generic 500 (never
> leak internals). Must be the **last** `app.use(...)`.

### `src/common/middlewares/validate.middleware.ts`
```ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodType } from 'zod';
import { ApiError } from '../utils/ApiError';

export const validate = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedValue = schema.parse(req.body);
      req.body = parsedValue; // Overwrite body with Zod's stripped/typed values
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessage = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        return next(ApiError.badRequest(errorMessage));
      }
      next(error);
    }
  };
};
```
> Validates `req.body`, then **overwrites** it with the parsed/stripped value so the
> controller always receives clean, typed data. Zod errors become a single 400 message.

### `src/common/utils/ApiError.ts`
```ts
export class ApiError extends Error {
    public statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message = "Bad request") { return new ApiError(400, message); }
    static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }
    static forbidden(message = "Forbidden") { return new ApiError(403, message); }
    static notFound(message = "Not found") { return new ApiError(404, message); }
    static conflict(message = "Conflict") { return new ApiError(409, message); }
    static internal(message = "Internal server error") { return new ApiError(500, message); }
  }
```
> Throw it anywhere in a service: `throw ApiError.notFound('Poll not found')`. The global
> handler maps it to the right HTTP status. Add more factory statics as needed.

### `src/common/utils/ApiResponse.ts`
```ts
import type { Response } from 'express';

export class ApiResponse {
  static ok(res: Response, message: string, data: any = null) {
    return res.status(200).json({ success: true, message, data });
  }

  static created(res: Response, message: string, data: any = null) {
    return res.status(201).json({ success: true, message, data });
  }

  static noContent(res: Response) {
    return res.status(204).send();
  }
}
```
> Every success response has shape `{ success: true, message, data }`. Every error has
> `{ success: false, message }`. Frontends can rely on this contract everywhere.

### `src/common/utils/jwt.utils.ts`
```ts
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

const isProduction = process.env.NODE_ENV === 'production';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || (isProduction ? '' : 'access-secret');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (isProduction ? '' : 'refresh-secret');

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  if (isProduction) {
    throw new Error('JWT secrets must be set in production!');
  }
}

const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export const generateAccessToken = (payload: object) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN as any,
  });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, JWT_ACCESS_SECRET) as any;
};

export const generateRefreshToken = (payload: object) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as any,
  });
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as any;
};

export const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  return { rawToken, hashedToken };
};

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
```
> **Token strategy:** short-lived access JWT (15m) + long-lived refresh JWT (7d). The
> refresh token is stored in the DB **hashed** (`hashToken`) so a DB leak can't reuse it.
> `generateResetToken` returns `{ raw, hashed }` — email the raw, store the hashed
> (same pattern for email verification + password reset).

### `src/common/realtime/events.ts`
```ts
export const REALTIME_CHANNELS = {
  analyticsUpdate: 'analytics:update',
} as const;

export const SOCKET_EVENTS = {
  pollJoin: 'poll:join',
  pollLeave: 'poll:leave',
  analyticsUpdate: 'analytics:update',
} as const;

export interface PollAnalyticsUpdateEvent {
  pollId: string;
  totalResponses: number;
  questionSummaries: Array<{
    questionId: string;
    counts: number[];
  }>;
  emittedAt: string;
}

export interface ResponseAcceptedEvent {
  pollId: string;
  analytics: PollAnalyticsUpdateEvent;
}
```
> Single source of truth for channel names, socket event names, and payload shapes.
> Both publisher (worker) and subscriber (socket) import from here so they can't drift.

### `src/common/realtime/socket.ts` — Redis sub → Socket room emit
```ts
import { createClient } from 'redis';
import type { Server } from 'socket.io';
import {
  REALTIME_CHANNELS,
  SOCKET_EVENTS,
  type ResponseAcceptedEvent,
} from './events';

export const setupSocketAndPubSub = async (io: Server) => {
  const subscriber = createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });

  subscriber.on('error', (error) => {
    console.error('[Redis] Subscriber Error:', error);
  });

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  io.on('connection', (socket) => {
    socket.on(SOCKET_EVENTS.pollJoin, (pollId: string) => {
      if (!pollId) return;
      socket.join(`poll_${pollId}`);
    });

    socket.on(SOCKET_EVENTS.pollLeave, (pollId: string) => {
      if (!pollId) return;
      socket.leave(`poll_${pollId}`);
    });
  });

  await subscriber.subscribe(REALTIME_CHANNELS.analyticsUpdate, (payload: string) => {
    const parsed = JSON.parse(payload) as ResponseAcceptedEvent;
    io.to(`poll_${parsed.pollId}`).emit(SOCKET_EVENTS.analyticsUpdate, parsed.analytics);
  });
};
```
> Clients `poll:join` a room keyed `poll_<id>`. A **dedicated** Redis subscriber listens on
> the channel and re-emits to only that room. This is the **horizontal-scaling** trick:
> any backend instance can publish; every instance's subscriber fans out to its own sockets.

### `src/common/realtime/socket.gateway.ts` (alternative helper)
```ts
import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { PollAnalyticsUpdateEvent } from './events';

let ioInstance: Server | null = null;

export const initSocketGateway = (httpServer: HttpServer): Server => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  ioInstance.on('connection', (socket) => {
    socket.on('poll:join', (pollId: string) => {
      if (pollId) {
        socket.join(pollId);
      }
    });

    socket.on('poll:leave', (pollId: string) => {
      if (pollId) {
        socket.leave(pollId);
      }
    });
  });

  return ioInstance;
};

export const emitPollAnalyticsUpdate = (event: PollAnalyticsUpdateEvent) => {
  if (!ioInstance) return;
  ioInstance.to(event.pollId).emit('analytics:update', event);
};
```
> A simpler singleton gateway for **single-instance** direct emits (no Redis bridge). The
> app uses `socket.ts` (the pub/sub path). Keep one or the other; don't mix room keys
> (`poll_<id>` vs `<id>`).

---

## Part F — `src/modules` (anatomy + full code)

> **This is the part you swap for a new backend.** Keep `auth/` as-is (it's reusable);
> replace `polls/`, `responses/`, `ai/` with your own domains following the same anatomy.

### F.0 — The module template (memorize)
For a domain `X`, create `src/modules/x/`:
```
x.route.ts        Router; binds paths → authenticate()/validate(schema) → X.controller.method
x.schema.ts       Zod create/update schemas + `export type ... = z.infer<...>`
x.controller.ts   class XController { static async method(req,res,next){ try{...}catch(e){next(e)} } }
x.service.ts      class XService { static async method(...){ business rules; throw ApiError } }
x.model.ts        Mongoose Schema + IX interface + export const XModel
```
Then register in `src/app.ts`: `app.use('/api/x', xRouter)`.

### F.1 — `auth/` module (reusable, copy as-is)

#### `auth/auth.model.ts`
```ts
import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  name: string;
  password?: string;
  sub?: string; // Optional: for backward compatibility or future OIDC use
  picture?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  verificationToken?: string;
  refreshToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  lastLogin: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, select: false },
  sub: { type: String, unique: true, sparse: true },
  picture: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  lastLogin: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

// Hash password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error: any) {
    throw error;
  }
});

UserSchema.methods.comparePassword = async function (candidatePassword: string) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
```
> Key tricks: `select: false` on sensitive fields (must `.select('+password')` to read);
> `pre('save')` hook auto-hashes the password only when modified; `comparePassword`
> instance method; `sub` is `sparse` unique for OAuth accounts.

#### `auth/auth.middleware.ts` — `authenticate()` + `authorize()`
```ts
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { verifyAccessToken } from '../../common/utils/jwt.utils';
import { UserModel } from './auth.model';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export const authenticate = (optional = false) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      if (optional) return next();
      throw ApiError.unauthorized('Not authenticated');
    }

    const decoded = verifyAccessToken(token) as any;
    const user = await UserModel.findById(decoded.id);

    if (!user) {
      if (optional) return next();
      throw ApiError.unauthorized('User no longer exists');
    }

    req.user = {
      id: (user._id as any).toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  } catch (error) {
    if (optional) return next();
    next(ApiError.unauthorized('Invalid or expired token'));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
};
```
> `authenticate()` is **required** auth; `authenticate(true)` is **optional** (sets
> `req.user` if a valid token exists, else continues anonymously — used for public voting).
> `authorize('admin')` is role-gating, chain it after `authenticate()`.
> `AuthRequest` is the typed request other modules import.

#### `auth/auth.service.ts`
```ts
import axios from 'axios';
import { UserModel } from './auth.model';
import type { IUser } from './auth.model';
import { ApiError } from '../../common/utils/ApiError';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateResetToken,
  hashToken,
} from '../../common/utils/jwt.utils';

import { sendVerificationEmail, sendResetPasswordEmail } from '../../common/config/email';

export class AuthService {
  static async register(userData: Partial<IUser>) {
    const { email, name, password, role } = userData;

    if (!email || !name || !password) {
      throw ApiError.badRequest('Email, name, and password are required');
    }

    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      throw ApiError.conflict('Email already registered');
    }

    const { rawToken, hashedToken } = generateResetToken();

    const user = await UserModel.create({
      email,
      name,
      password,
      role: role || 'user',
      verificationToken: hashedToken,
      isVerified: false,
    });

    try {
      await sendVerificationEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to send verification email:', error.message);
    }

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.verificationToken;
    return userObj;
  }

  static async login(credentials: { email?: string; password?: string }) {
    const { email, password } = credentials;

    if (!email || !password) {
      throw ApiError.badRequest('Email and password are required');
    }

    const user = await UserModel.findOne({ email }).select('+password');
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isVerified) {
      throw ApiError.forbidden('Please verify your email before logging in');
    }

    const accessToken = generateAccessToken({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role
    });
    const refreshToken = generateRefreshToken({ id: user._id });

    // Store hashed refresh token in DB
    user.refreshToken = hashToken(refreshToken);
    user.lastLogin = new Date();
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return { user: userObj, accessToken, refreshToken };
  }

  static async refresh(token?: string) {
    if (!token) {
      throw ApiError.unauthorized('Refresh token missing');
    }

    try {
      const decoded = verifyRefreshToken(token) as any;
      const user = await UserModel.findById(decoded.id).select('+refreshToken');

      if (!user || user.refreshToken !== hashToken(token)) {
        throw ApiError.unauthorized('Invalid refresh token — please log in again');
      }

      const accessToken = generateAccessToken({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      });
      return { accessToken };
    } catch (error) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }
  }

  static async logout(userId: string) {
    await UserModel.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
  }

  static async logoutByToken(token: string) {
    const hashedToken = hashToken(token);
    await UserModel.findOneAndUpdate({ refreshToken: hashedToken }, { $unset: { refreshToken: 1 } });
  }

  static async resendVerification(email: string) {
    const user = await UserModel.findOne({ email }).select('+isVerified');
    if (!user) {
      throw ApiError.notFound('No account with that email');
    }

    if (user.isVerified) {
      throw ApiError.badRequest('Email is already verified');
    }

    const { rawToken, hashedToken } = generateResetToken();
    user.verificationToken = hashedToken;
    await user.save();

    try {
      await sendVerificationEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to resend verification email:', error.message);
    }
  }

  static async verifyEmail(token: string) {
    const trimmedToken = String(token).trim();
    if (!trimmedToken) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    const hashedInput = hashToken(trimmedToken);

    // Check both hashed and raw (for flexibility during development)
    let user = await UserModel.findOne({ verificationToken: hashedInput }).select('+verificationToken');
    if (!user) {
      user = await UserModel.findOne({ verificationToken: trimmedToken }).select('+verificationToken');
    }

    if (!user) {
      throw ApiError.badRequest('Invalid or expired verification token');
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    return user;
  }

  static async forgotPassword(email: string) {
    const user = await UserModel.findOne({ email });
    if (!user) {
      throw ApiError.notFound('No account with that email');
    }

    const { rawToken, hashedToken } = generateResetToken();

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    try {
      await sendResetPasswordEmail(email, rawToken);
    } catch (error: any) {
      console.error('Failed to send reset email:', error.message);
    }
  }

  static async resetPassword(token: string, newPassword: string) {
    const hashedToken = hashToken(token);

    const user = await UserModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw ApiError.badRequest('Invalid or expired reset token');
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
  }

  static async getMe(userId: string) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    return user;
  }

  static getGoogleAuthUrl() {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  static async handleGoogleCallback(code: string) {
    const url = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: 'authorization_code',
    };

    try {
      const res = await axios.post(url, new URLSearchParams(values), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token } = res.data;

      // Fetch user info from Google
      const googleUserRes = await axios.get(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      );

      const googleUser = googleUserRes.data;

      if (!googleUser.email_verified && !googleUser.verified_email) {
        throw ApiError.forbidden('Google account is not verified');
      }

      let user = await UserModel.findOne({ email: googleUser.email });

      if (!user) {
        user = await UserModel.create({
          email: googleUser.email,
          name: googleUser.name || googleUser.given_name,
          picture: googleUser.picture,
          isVerified: true,
          role: 'user',
          sub: googleUser.sub,
        });
      } else {
        user.name = googleUser.name || googleUser.given_name;
        user.picture = googleUser.picture;
        user.isVerified = true;
        user.lastLogin = new Date();
        user.sub = googleUser.sub;
        await user.save();
      }

      const accessToken = generateAccessToken({
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      });
      const refreshToken = generateRefreshToken({ id: user._id });

      user.refreshToken = hashToken(refreshToken);
      await user.save();

      return { user, accessToken, refreshToken };
    } catch (error: any) {
      const detail = error.response?.data?.error_description || error.response?.data?.error || error.message;
      console.error('Google OAuth Error:', detail);
      throw ApiError.unauthorized(`Google authentication failed: ${detail}`);
    }
  }
}
```

#### `auth/auth.controller.ts`
```ts
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { verifyAccessToken } from '../../common/utils/jwt.utils';
import type { AuthRequest } from './auth.middleware';

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await AuthService.register(req.body);
      return ApiResponse.created(res, 'Registration successful. Please verify your email.', user);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { user, accessToken, refreshToken } = await AuthService.login(req.body);
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);
      return ApiResponse.ok(res, 'Login successful', { user, accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      const { accessToken } = await AuthService.refresh(token);
      return ApiResponse.ok(res, 'Token refreshed', { accessToken });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (token) {
        await AuthService.logoutByToken(token);
      }
      res.clearCookie('refreshToken', sessionCookieOptions);
      return ApiResponse.ok(res, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;
      if (!email) {
        throw ApiError.badRequest('Email is required');
      }
      await AuthService.resendVerification(email);
      return ApiResponse.ok(res, 'Verification email resent');
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.verifyEmail(req.params.token as string);
      return ApiResponse.ok(res, 'Email verified successfully');
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.forgotPassword(req.body.email);
      return ApiResponse.ok(res, 'Password reset email sent');
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await AuthService.resetPassword(req.params.token as string, req.body.password);
      return ApiResponse.ok(res, 'Password reset successful');
    } catch (error) {
      next(error);
    }
  }

  static async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return ApiResponse.ok(res, 'No active session', null);
      }
      const user = await AuthService.getMe(req.user.id);
      return ApiResponse.ok(res, 'User profile fetched', user);
    } catch (error) {
      next(error);
    }
  }

  static async googleLogin(req: Request, res: Response) {
    const url = AuthService.getGoogleAuthUrl();
    res.redirect(url);
  }

  static async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.query;
      if (!code) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=Google authentication failed`);
      }

      const { user, accessToken, refreshToken } = await AuthService.handleGoogleCallback(code as string);
      res.cookie('refreshToken', refreshToken, sessionCookieOptions);

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
      redirectUrl.searchParams.set('token', accessToken);

      console.log(`[Auth] Redirecting to frontend: ${redirectUrl.origin}${redirectUrl.pathname}`);
      res.redirect(redirectUrl.toString());
    } catch (error: any) {
      console.error('Google callback error:', error);
      const errorMessage = error.message || 'Google authentication failed';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
    }
  }
}
```

#### `auth/auth.route.ts`
```ts
import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from './auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { registerSchema } from './dto/register.schema';
import { loginSchema } from './dto/login.schema';
import { forgotPasswordSchema } from './dto/forgot-password.schema';
import { resetPasswordSchema } from './dto/reset-password.schema';

const router = Router();

router.post('/register', validate(registerSchema), AuthController.register as any);
router.post('/login', validate(loginSchema), AuthController.login as any);
router.post('/refresh-token', AuthController.refreshToken as any);
router.post('/logout', AuthController.logout as any);
router.get('/verify-email/:token', AuthController.verifyEmail as any);
router.post('/resend-verification', AuthController.resendVerification as any);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword as any);
router.put('/reset-password/:token', validate(resetPasswordSchema), AuthController.resetPassword as any);
router.get('/me', authenticate() as any, AuthController.me as any);

// Google OAuth
router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback as any);

export default router;
```

#### `auth/dto/*.schema.ts`
```ts
// register.schema.ts
import { z } from 'zod';
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email address').lowercase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit'),
  role: z.enum(['user', 'admin']).default('user'),
});
export type RegisterInput = z.infer<typeof registerSchema>;
```
```ts
// login.schema.ts
import { z } from 'zod';
export const loginSchema = z.object({
  email: z.string().email('Invalid email address').lowercase(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;
```
```ts
// forgot-password.schema.ts
import { z } from 'zod';
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').lowercase(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
```
```ts
// reset-password.schema.ts
import { z } from 'zod';
export const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

### F.2 — `polls/` module (example domain — replace with yours)

#### `polls/polls.model.ts`
```ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IQuestion {
  _id?: mongoose.Types.ObjectId;
  text: string;
  options: string[];
  isMandatory: boolean;
}

export interface IPoll extends Document {
  creatorId: string;
  title: string;
  isAnonymous: boolean;
  expiresAt: Date;
  isPublished: boolean;
  isClosed: boolean;
  closedAt?: Date | null;
  isResultsPublished: boolean;
  resultsPublishedAt?: Date | null;
  questions: IQuestion[];
}

// Embedded Question Schema
const QuestionSchema = new Schema<IQuestion>({
  text: { type: String, required: true },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length >= 2,
      message: "A question must have at least 2 options."
    }
  },
  isMandatory: { type: Boolean, default: true }
});

// Core Poll Schema
const PollSchema = new Schema<IPoll>({
  creatorId: { type: String, required: true },
  title: { type: String, required: true },
  isAnonymous: { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
  isPublished: { type: Boolean, default: false },
  isClosed: { type: Boolean, default: false },
  closedAt: { type: Date, default: null },
  isResultsPublished: { type: Boolean, default: false },
  resultsPublishedAt: { type: Date, default: null },
  questions: {
    type: [QuestionSchema],
    required: true,
    validate: {
      validator: (v: IQuestion[]) => v.length > 0,
      message: "A poll must contain at least one question."
    }
  }
}, {
  timestamps: true
});

export const PollModel = mongoose.model<IPoll>('Poll', PollSchema);
```
> Patterns to reuse: **embedded sub-documents** (`QuestionSchema` inside `PollSchema`),
> **schema-level `validate`** for invariants, `timestamps: true` for `createdAt/updatedAt`,
> lifecycle booleans (`isPublished`/`isClosed`/`isResultsPublished`) with paired timestamps.

#### `polls/polls.schema.ts`
```ts
import { z } from 'zod';

const pollQuestionSchema = z.object({
  text: z.string().min(3, "Question text must be at least 3 characters"),
  options: z.array(z.string().min(1, "Option cannot be empty")).min(2, "Each question needs at least 2 options"),
  isMandatory: z.boolean().default(true),
});

export const createPollSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long"),
  isAnonymous: z.boolean().default(true),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: "Expiry date must be in the future",
  }),
  isPublished: z.boolean().default(false),
  questions: z.array(pollQuestionSchema).min(1, "A poll must contain at least one question"),
});

export const updatePollSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long").optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: "Expiry date must be in the future",
  }).optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(pollQuestionSchema).min(1, "A poll must contain at least one question").optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field is required for update",
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;
```
> Reuse patterns: `.refine()` for cross-field/business validation (future date, non-empty
> update); `update` schema = all-optional version of `create`; **export inferred types** so
> services are typed without duplicating shapes.

#### `polls/polls.service.ts`
```ts
import { PollModel } from './polls.model';
import type { CreatePollInput, UpdatePollInput } from './polls.schema';
import { ApiError } from '../../common/utils/ApiError';
import { AnalyticsModel } from '../responses/analytics.model';

export class PollService {
  static async createPoll(payload: CreatePollInput, creatorId: string) {
    const newPoll = await PollModel.create({
      ...payload,
      expiresAt: new Date(payload.expiresAt),
      creatorId,
    });

    // Create the paired analytics aggregate doc up front (zeros)
    await AnalyticsModel.create({
      pollId: newPoll._id,
      totalResponses: 0,
      questionSummaries: newPoll.questions.map((question) => ({
        questionId: question._id,
        counts: question.options.map(() => 0),
      })),
    });

    return newPoll;
  }

  static async getPollById(pollId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }
    return poll;
  }

  static async listPollsByCreator(creatorId: string) {
    return PollModel.find({ creatorId }).sort({ createdAt: -1 });
  }

  static async updatePoll(pollId: string, payload: UpdatePollInput) {
    const poll = await this.getPollById(pollId);

    if (poll.isClosed) {
      throw ApiError.badRequest('Closed polls cannot be updated');
    }

    if (payload.title !== undefined) poll.title = payload.title;
    if (payload.isAnonymous !== undefined) poll.isAnonymous = payload.isAnonymous;
    if (payload.expiresAt !== undefined) poll.expiresAt = new Date(payload.expiresAt);
    if (payload.isPublished !== undefined) poll.isPublished = payload.isPublished;
    if (payload.questions !== undefined) {
      poll.questions = payload.questions as any;

      // Sync AnalyticsModel to match new questions while preserving existing counts
      const analytics = await AnalyticsModel.findOne({ pollId: poll._id });
      if (analytics) {
        const existingMap = new Map(
          analytics.questionSummaries.map((s) => [String(s.questionId), s.counts])
        );

        analytics.questionSummaries = poll.questions.map((q) => {
          const existingCounts = existingMap.get(String(q._id));
          const counts = (existingCounts && existingCounts.length === q.options.length)
            ? existingCounts
            : q.options.map(() => 0);
          return { questionId: q._id, counts } as any;
        });

        await analytics.save();
      }
    }

    await poll.save();
    return poll;
  }

  static async closePoll(pollId: string) {
    const poll = await this.getPollById(pollId);
    if (poll.isClosed) return poll;

    poll.isClosed = true;
    poll.expiresAt = new Date();
    poll.closedAt = new Date();
    await poll.save();
    return poll;
  }

  static async deletePoll(pollId: string) {
    const poll = await PollModel.findByIdAndDelete(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }
    await AnalyticsModel.findOneAndDelete({ pollId }); // cascade
    return poll;
  }

  static async publishResults(pollId: string) {
    const poll = await this.getPollById(pollId);

    const isExpired = poll.expiresAt.getTime() <= Date.now();
    if (!poll.isClosed && !isExpired) {
      throw ApiError.badRequest('Results can only be published after the poll is closed or expired');
    }

    poll.isResultsPublished = true;
    poll.resultsPublishedAt = new Date();
    await poll.save();
    return poll;
  }
}
```
> Reuse patterns: `static` methods on a class (no instance state), all rules enforced here
> (not in controller), `getPollById` throws `notFound` and is reused internally, and
> **cascade**: creating/deleting/updating a poll keeps the paired analytics doc in sync.

#### `polls/polls.controller.ts`
```ts
import type { Request, Response, NextFunction } from 'express';
import { PollService } from './polls.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';

export class PollController {
  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const creatorId = req.user.id;
      const poll = await PollService.createPoll(req.body, creatorId);
      return ApiResponse.created(res, "Poll created successfully", poll);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const poll = await PollService.getPollById(String(pollId));
      return ApiResponse.ok(res, 'Poll fetched successfully', poll);
    } catch (error) {
      next(error);
    }
  }

  static async listByCreator(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const polls = await PollService.listPollsByCreator(req.user.id);
      return ApiResponse.ok(res, 'Polls fetched successfully', polls);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { pollId } = req.params;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to update this poll');
      }

      const updatedPoll = await PollService.updatePoll(String(pollId), req.body);
      return ApiResponse.ok(res, 'Poll updated successfully', updatedPoll);
    } catch (error) {
      next(error);
    }
  }

  static async close(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to close this poll');
      }

      const closedPoll = await PollService.closePoll(String(pollId));
      return ApiResponse.ok(res, 'Poll closed successfully', closedPoll);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to delete this poll');
      }

      await PollService.deletePoll(String(pollId));
      return ApiResponse.ok(res, 'Poll deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async publishResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to publish results for this poll');
      }

      const publishedPoll = await PollService.publishResults(String(pollId));
      return ApiResponse.ok(res, 'Poll results published successfully', publishedPoll);
    } catch (error) {
      next(error);
    }
  }
}
```
> **Ownership check pattern:** fetch the resource, compare `resource.creatorId` to
> `req.user.id`, throw `forbidden` if mismatch. Every mutating endpoint repeats this.

#### `polls/polls.route.ts`
```ts
import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollSchema, updatePollSchema } from './polls.schema';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

router.post('/', authenticate(), validate(createPollSchema), PollController.create);
router.get('/', authenticate(), PollController.listByCreator);
router.get('/:id', PollController.getById);                                  // public read
router.patch('/:pollId', authenticate(), validate(updatePollSchema), PollController.update);
router.post('/:id/close', authenticate(), PollController.close);
router.post('/:id/publish-results', authenticate(), PollController.publishResults);
router.delete('/:id', authenticate(), PollController.delete);

export default router;
```
> Middleware chain order: `authenticate()` → `validate(schema)` → controller. Public reads
> simply omit `authenticate()`.

### F.3 — `responses/` module (domain + CQRS write-behind worker)

This module is the **architecturally interesting** one. It uses a **write-behind / CQRS**
pattern: votes hit Redis counters instantly (fast write path), a background worker flushes
them to Mongo every 2s in one `bulkWrite`, then publishes a realtime event.

#### `responses/responses.model.ts`
```ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IResponseAnswer {
  questionId: mongoose.Types.ObjectId;
  selectedOptionIndex: number;
}

export interface IResponse extends Document {
  pollId: mongoose.Types.ObjectId;
  respondentId: string;
  answers: IResponseAnswer[];
  createdAt: Date;
  updatedAt: Date;
}

const ResponseAnswerSchema = new Schema<IResponseAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    selectedOptionIndex: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ResponseSchema = new Schema<IResponse>(
  {
    pollId: { type: Schema.Types.ObjectId, required: true, index: true, ref: 'Poll' },
    respondentId: { type: String, required: true },
    answers: { type: [ResponseAnswerSchema], required: true },
  },
  { timestamps: true },
);

export const ResponseModel = mongoose.model<IResponse>('Response', ResponseSchema);
```

#### `responses/analytics.model.ts` (secondary aggregate / read model)
```ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IAnalyticsQuestionSummary {
  questionId: mongoose.Types.ObjectId;
  counts: number[];
}

export interface IAnalytics extends Document {
  pollId: mongoose.Types.ObjectId;
  totalResponses: number;
  questionSummaries: IAnalyticsQuestionSummary[];
}

const AnalyticsQuestionSummarySchema = new Schema<IAnalyticsQuestionSummary>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    counts: { type: [Number], required: true, default: [] },
  },
  { _id: false },
);

const AnalyticsSchema = new Schema<IAnalytics>(
  {
    pollId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true, ref: 'Poll' },
    totalResponses: { type: Number, required: true, default: 0 },
    questionSummaries: { type: [AnalyticsQuestionSummarySchema], required: true, default: [] },
  },
  { timestamps: true },
);

export const AnalyticsModel = mongoose.model<IAnalytics>('Analytics', AnalyticsSchema);
```

#### `responses/responses.schema.ts`
```ts
import { z } from 'zod';

export const submitResponseSchema = z.object({
  pollId: z.string().min(1, 'pollId is required'),
  deviceId: z.string().min(1, 'deviceId is required'),
  respondentId: z.string().optional(),
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'questionId is required'),
      selectedOptionIndex: z.number().int().min(0),
    }),
  ).min(1, 'At least one answer is required'),
});

export type SubmitResponseInput = z.infer<typeof submitResponseSchema>;
```

#### `responses/responses.service.ts` (the fast write path + read model + cache)
```ts
import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel } from '../polls/polls.model';
import { ResponseModel } from './responses.model';
import type { SubmitResponseInput } from './responses.schema';
import { AnalyticsModel } from './analytics.model';
import type { PollAnalyticsUpdateEvent } from '../../common/realtime/events';
import { UserModel } from '../auth/auth.model';

export class ResponseService {
  static async submitResponse(payload: SubmitResponseInput) {
    const poll = await PollModel.findById(payload.pollId);
    if (!poll) throw ApiError.notFound('Poll not found');
    if (!poll.isPublished) throw ApiError.badRequest('Poll is not published');
    if (poll.isClosed) throw ApiError.badRequest('Poll is closed');
    if (poll.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest('Poll is expired');

    const questionMap = new Map(
      poll.questions.map((question) => [String(question._id), question]),
    );
    const providedQuestionIds = new Set(payload.answers.map((a) => a.questionId));

    // Mandatory-question enforcement
    for (const question of poll.questions) {
      if (question.isMandatory && !providedQuestionIds.has(String(question._id))) {
        throw ApiError.badRequest(`Mandatory question '${question.text}' is missing`);
      }
    }

    // Answer validity
    for (const answer of payload.answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        throw ApiError.badRequest(`Question ${answer.questionId} does not belong to this poll`);
      }
      if (answer.selectedOptionIndex < 0 || answer.selectedOptionIndex >= question.options.length) {
        throw ApiError.badRequest(`Invalid selectedOptionIndex for question ${answer.questionId}`);
      }
    }

    if (!poll.isAnonymous && !payload.respondentId) {
      throw ApiError.unauthorized('This poll requires you to be logged in to vote.');
    }

    // Anti-spam: one vote per device per poll for 24h
    const spamKey = `poll:${payload.pollId}:voted:${payload.deviceId}`;
    const hasVoted = await redisClient.get(spamKey);
    if (hasVoted) {
      throw ApiError.conflict('You have already voted on this poll.');
    }
    await redisClient.setEx(spamKey, 86400, 'true');

    // WRITE-BEHIND: buffer counts in Redis (fast), worker flushes to Mongo later
    const pipeline = redisClient.multi();
    pipeline.sAdd('buffer:active_polls', payload.pollId);
    pipeline.incr(`buffer:poll:${payload.pollId}:total`);
    for (const answer of payload.answers) {
      pipeline.hIncrBy(
        `buffer:poll:${payload.pollId}:question:${answer.questionId}`,
        String(answer.selectedOptionIndex),
        1,
      );
    }
    await pipeline.exec();

    // Durable backup (fire-and-forget; don't block the vote on Mongo)
    ResponseModel.create({
      pollId: new mongoose.Types.ObjectId(payload.pollId),
      respondentId: payload.respondentId ?? 'mock-respondent-123',
      answers: payload.answers.map((a) => ({
        questionId: new mongoose.Types.ObjectId(a.questionId),
        selectedOptionIndex: a.selectedOptionIndex,
      })),
    }).catch((error: unknown) => {
      console.error('[Mongo Backup Error]', error);
    });

    return { message: 'Response recorded successfully' };
  }

  // READ MODEL with cache
  static async getPollAnalytics(pollId: string): Promise<PollAnalyticsUpdateEvent> {
    const cacheKey = `poll:${pollId}:analytics_cache`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PollAnalyticsUpdateEvent;
    }

    let analyticsDoc = await AnalyticsModel.findOne({
      pollId: new mongoose.Types.ObjectId(pollId),
    });

    // Self-healing: rebuild analytics doc if missing
    if (!analyticsDoc) {
      const poll = await PollModel.findById(pollId);
      if (!poll) throw ApiError.notFound('Poll not found');
      analyticsDoc = await AnalyticsModel.create({
        pollId: poll._id,
        totalResponses: 0,
        questionSummaries: poll.questions.map((q) => ({
          questionId: q._id,
          counts: q.options.map(() => 0),
        })),
      });
    }

    const analytics: PollAnalyticsUpdateEvent = {
      pollId,
      totalResponses: analyticsDoc.totalResponses,
      questionSummaries: analyticsDoc.questionSummaries.map((summary) => ({
        questionId: String(summary.questionId),
        counts: summary.counts,
      })),
      emittedAt: new Date().toISOString(),
    };

    await redisClient.set(cacheKey, JSON.stringify(analytics), { EX: 3600 });
    return analytics;
  }

  static async getPollResponsesList(pollId: string, userId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) throw ApiError.notFound('Poll not found');

    if (String(poll.creatorId) !== String(userId)) {
      throw ApiError.forbidden('You are not authorized to view individual responses for this poll');
    }

    const responses = await ResponseModel.find({
      pollId: new mongoose.Types.ObjectId(pollId),
    }).sort({ createdAt: -1 });

    // Resolve registered voters' names/emails in one query
    const registeredUserIds = responses
      .map((r) => r.respondentId)
      .filter((id) => id && !id.startsWith('guest:') && mongoose.Types.ObjectId.isValid(id));

    const users = await UserModel.find({
      _id: { $in: registeredUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select('name email');

    const userMap = new Map(users.map((u) => [String(u._id), u]));

    return responses.map((r) => {
      let voter = { type: 'anonymous', name: 'Anonymous Voter', email: '' };

      if (!poll.isAnonymous && r.respondentId) {
        if (r.respondentId.startsWith('guest:')) {
          const parts = r.respondentId.split(':');
          voter = { type: 'guest', name: parts[2] || 'Guest Voter', email: parts[1] || '' };
        } else {
          const userDoc = userMap.get(r.respondentId);
          voter = userDoc
            ? { type: 'registered', name: userDoc.name, email: userDoc.email }
            : { type: 'registered', name: 'Registered Voter', email: r.respondentId };
        }
      }

      return {
        _id: r._id,
        voter,
        answers: r.answers.map((ans) => {
          const question = poll.questions.find((q) => String(q._id) === String(ans.questionId));
          return {
            questionId: String(ans.questionId),
            questionText: question ? question.text : 'Unknown Question',
            selectedOptionIndex: ans.selectedOptionIndex,
            selectedOptionText: question && ans.selectedOptionIndex >= 0 && ans.selectedOptionIndex < question.options.length
              ? question.options[ans.selectedOptionIndex]
              : 'Skipped/Invalid',
          };
        }),
        createdAt: r.createdAt,
      };
    });
  }
}
```

#### `responses/analytics.worker.ts` (background flush every 2s)
```ts
import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { REALTIME_CHANNELS, type ResponseAcceptedEvent } from '../../common/realtime/events';
import { AnalyticsModel } from './analytics.model';
import { ResponseService } from './responses.service';

const WORKER_INTERVAL_MS = 2000;

type BufferQuestionCount = {
  questionId: string;
  countsByIndex: Record<string, string>;
};

const getQuestionBufferKeys = async (pollId: string): Promise<string[]> => {
  const pattern = `buffer:poll:${pollId}:question:*`;
  return redisClient.keys(pattern);
};

const parseQuestionCount = async (key: string): Promise<BufferQuestionCount | null> => {
  const questionId = key.split('question:')[1];
  if (!questionId) return null;
  const countsByIndex = await redisClient.hGetAll(key);
  return { questionId, countsByIndex };
};

export const startAnalyticsWorker = () => {
  setInterval(async () => {
    try {
      // Pop ONE active poll per tick (sPop = atomic claim, prevents double-processing)
      const pollId = await redisClient.sPop('buffer:active_polls');
      if (!pollId) return;

      const totalDeltaString = await redisClient.get(`buffer:poll:${pollId}:total`);
      const totalDelta = totalDeltaString ? Number.parseInt(totalDeltaString, 10) : 0;
      const questionKeys = await getQuestionBufferKeys(pollId);

      const parsedQuestionCounts = (
        await Promise.all(questionKeys.map((key) => parseQuestionCount(key)))
      ).filter((item): item is BufferQuestionCount => item !== null);

      const updatePipeline = redisClient.multi();
      const bulkOperations: Array<{
        updateOne: {
          filter: { pollId: mongoose.Types.ObjectId };
          update: { $inc: Record<string, number> };
          arrayFilters?: Array<Record<string, mongoose.Types.ObjectId>>;
        };
      }> = [];

      if (totalDelta > 0) {
        bulkOperations.push({
          updateOne: {
            filter: { pollId: new mongoose.Types.ObjectId(pollId) },
            update: { $inc: { totalResponses: totalDelta } },
          },
        });
      }

      // Build positional-array $inc operations using arrayFilters
      for (const item of parsedQuestionCounts) {
        if (!item.questionId || item.questionId === 'undefined') {
          console.warn(`[Analytics Worker] Skipping invalid questionId: ${item.questionId} for poll: ${pollId}`);
          continue;
        }
        for (const [index, value] of Object.entries(item.countsByIndex)) {
          const incrementBy = Number.parseInt(value, 10);
          if (!incrementBy) continue;
          try {
            bulkOperations.push({
              updateOne: {
                filter: { pollId: new mongoose.Types.ObjectId(pollId) },
                update: { $inc: { [`questionSummaries.$[question].counts.${index}`]: incrementBy } },
                arrayFilters: [{ 'question.questionId': new mongoose.Types.ObjectId(item.questionId) }],
              },
            });
          } catch (e) {
            console.error(`[Analytics Worker] Failed to build operation for question: ${item.questionId}`, e);
          }
        }
      }

      // One bulkWrite for the whole tick
      if (bulkOperations.length > 0) {
        await AnalyticsModel.bulkWrite(bulkOperations, { ordered: false });
      }

      // Clear buffers + stale cache
      updatePipeline.del(`buffer:poll:${pollId}:total`);
      for (const key of questionKeys) updatePipeline.del(key);
      updatePipeline.del(`poll:${pollId}:analytics_cache`);
      await updatePipeline.exec();

      // Publish fresh snapshot for socket fanout
      const analytics = await ResponseService.getPollAnalytics(pollId);
      const event: ResponseAcceptedEvent = { pollId, analytics };
      await redisClient.publish(REALTIME_CHANNELS.analyticsUpdate, JSON.stringify(event));
    } catch (error: unknown) {
      console.error('[Analytics Worker Error]', error);
    }
  }, WORKER_INTERVAL_MS);
};
```
> **Why this matters:** voting never blocks on Mongo. Redis absorbs spikes; the worker
> batches all deltas for a poll into one `bulkWrite` with positional `arrayFilters`, busts
> the cache, and republishes. Started once in `app.ts` via `startAnalyticsWorker()`.

#### `responses/responses.controller.ts`
```ts
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ResponseService } from './responses.service';

export class ResponsesController {
  static async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const response = await ResponseService.submitResponse({
        ...req.body,
        respondentId: (req as any).user?.id || req.body.respondentId,
      });
      return ApiResponse.created(res, 'Response submitted successfully', response);
    } catch (error) {
      next(error);
    }
  }

  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const summary = await ResponseService.getPollAnalytics(String(pollId));
      return ApiResponse.ok(res, 'Poll analytics fetched successfully', summary);
    } catch (error) {
      next(error);
    }
  }

  static async getResponsesList(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId;
      const userId = (req as any).user?.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      if (!userId) throw ApiError.unauthorized('Not authenticated');
      const list = await ResponseService.getPollResponsesList(String(pollId), userId);
      return ApiResponse.ok(res, 'Poll responses list fetched successfully', list);
    } catch (error) {
      next(error);
    }
  }
}
```

#### `responses/responses.route.ts`
```ts
import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { authenticate } from '../auth/auth.middleware';
import { ResponsesController } from './responses.controller';
import { submitResponseSchema } from './responses.schema';

const router = Router();

router.post('/', authenticate(true) as any, validate(submitResponseSchema), ResponsesController.submit);  // optional auth
router.get('/poll/:pollId/summary', ResponsesController.getSummary);                                       // public
router.get('/poll/:pollId/list', authenticate() as any, ResponsesController.getResponsesList);            // owner-only

export default router;
```

### F.4 — `ai/` module (OPTIONAL — LangChain + LangGraph structured output)

> Drop this whole module if your new backend has no AI. If you keep it, the takeaways are:
> (1) structured output validated by the **same Zod schema** as your create endpoint,
> (2) a **mock fallback** when the API key is absent, (3) AI persists by **calling the
> domain service**, never the model directly.

#### `ai/ai.schema.ts`
```ts
import { z } from 'zod';
import { createPollSchema } from '../polls/polls.schema';

export const generatePollRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters'),
  tone: z
    .enum(['professional', 'casual', 'funny', 'educational', 'professional & casual'])
    .default('professional & casual'),
  questionCount: z.number().int().min(1).max(10).default(5),
  isAnonymous: z.boolean().default(true),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: 'Expiry date must be in the future',
  }),
});

// Reuse the poll create schema's shape so AI output IS a valid poll payload
export const generatedPollSchema = createPollSchema.pick({
  title: true,
  questions: true,
}).extend({
  isAnonymous: z.boolean(),
  expiresAt: z.string(),
  isPublished: z.boolean().default(false),
});

export const generateAndSavePollRequestSchema = generatePollRequestSchema.extend({
  creatorId: z.string().default('mock-creator-id-123'),
});

export type GeneratePollRequestInput = z.infer<typeof generatePollRequestSchema>;
export type GeneratedPollOutput = z.infer<typeof generatedPollSchema>;
export type GenerateAndSavePollRequestInput = z.infer<typeof generateAndSavePollRequestSchema>;
```

#### `ai/ai.service.ts`
```ts
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph } from '@langchain/langgraph';
import { ApiError } from '../../common/utils/ApiError';
import { PollService } from '../polls/polls.service';
import { generatedPollSchema } from './ai.schema';
import type { GeneratedPollOutput, GenerateAndSavePollRequestInput, GeneratePollRequestInput } from './ai.schema';

type AiGraphState = {
  topic: string;
  tone: GeneratePollRequestInput['tone'];
  questionCount: number;
  generated?: GeneratedPollOutput;
};

export class AiService {
  private static getModel() {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      return null;  // signal: use mock fallback
    }
    return new ChatGoogleGenerativeAI({
      model: 'gemini-flash-lite-latest',
      temperature: 0.3,
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  private static buildMockDraft(input: GeneratePollRequestInput): GeneratedPollOutput {
    return generatedPollSchema.parse({
      title: `AI Mock Poll: ${input.topic.trim().slice(0, 50)}`,
      isAnonymous: input.isAnonymous,
      expiresAt: input.expiresAt,
      isPublished: false,
      questions: [
        { text: 'How clear is this poll topic?', options: ['Very clear', 'Somewhat clear', 'Not clear'], isMandatory: true },
        { text: 'How interested are you in participating further?', options: ['Very interested', 'Maybe later', 'Not interested'], isMandatory: true },
      ],
    });
  }

  private static async generateWithGraph(input: GeneratePollRequestInput): Promise<GeneratedPollOutput> {
    const model = this.getModel();
    if (!model) return this.buildMockDraft(input);

    const structuredModel = model.withStructuredOutput(generatedPollSchema);

    const graph = new StateGraph<AiGraphState>({
      channels: {
        topic: { value: (left) => left, default: () => input.topic },
        tone: { value: (left) => left, default: () => input.tone },
        questionCount: { value: (left) => left, default: () => input.questionCount },
        generated: { value: (left) => left, default: () => undefined },
      },
    })
      .addNode('generatePoll', async () => {
        const systemPrompt = [
          `You are an expert UX Researcher and Survey Designer.`,
          `Create a highly engaging, ${input.tone} polling payload based on the following topic or context:`,
          `"${input.topic}"`,
          ``,
          `CRITICAL RULES:`,
          `- You MUST generate EXACTLY ${input.questionCount} questions. No more, no less.`,
          `- All questions must be single-option multiple choice.`,
          `- Each question must have between 2 and 4 engaging options.`,
          `- Maintain a ${input.tone} tone strictly throughout the questions and options.`,
          `- Ensure JSON keys match our strict Zod schema perfectly.`,
        ].join('\n');

        const generated = await structuredModel.invoke(systemPrompt);
        return {
          generated: { ...generated, isAnonymous: input.isAnonymous, expiresAt: input.expiresAt, isPublished: false },
        };
      })
      .addEdge('__start__', 'generatePoll')
      .addEdge('generatePoll', '__end__');

    try {
      const compiled = graph.compile();
      const result = await compiled.invoke({
        topic: input.topic,
        tone: input.tone,
        questionCount: input.questionCount,
      });
      if (!result.generated) throw ApiError.badRequest('AI could not generate a valid poll');
      return generatedPollSchema.parse(result.generated);  // final contract enforcement
    } catch (error) {
      console.error('[AI Generation Error]', error);
      return this.buildMockDraft(input);  // never 500 — degrade to mock
    }
  }

  static async generatePollDraft(input: GeneratePollRequestInput) {
    return this.generateWithGraph(input);
  }

  static async generateAndSavePoll(input: GenerateAndSavePollRequestInput) {
    const draft = await this.generateWithGraph(input);
    const poll = await PollService.createPoll(draft, input.creatorId);  // delegate persistence
    return { draft, poll };
  }
}
```

#### `ai/ai.controller.ts`
```ts
import type { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { AiService } from './ai.service';

export class AiController {
  static async generateDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const draft = await AiService.generatePollDraft(req.body);
      return ApiResponse.ok(res, 'AI poll draft generated successfully', draft);
    } catch (error) {
      next(error);
    }
  }

  static async generateAndSave(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = { ...req.body, creatorId: req.body.creatorId || 'mock-creator-id-123' };
      const result = await AiService.generateAndSavePoll(payload);
      return ApiResponse.created(res, 'AI poll generated and saved successfully', result);
    } catch (error) {
      next(error);
    }
  }
}
```

#### `ai/ai.route.ts`
```ts
import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { AiController } from './ai.controller';
import { generateAndSavePollRequestSchema, generatePollRequestSchema } from './ai.schema';

const router = Router();

router.post('/generate', validate(generatePollRequestSchema), AiController.generateDraft);
router.post('/generate-and-save', validate(generateAndSavePollRequestSchema), AiController.generateAndSave);

export default router;
```

### F.5 — Tests (`tests/`)
Bun's built-in test runner. Services are tested by **monkey-patching model statics** so no
real DB is needed.

```ts
// tests/ai.contract.test.ts
import { describe, expect, it } from 'bun:test';
import { generatedPollSchema } from '../src/modules/ai/ai.schema';

describe('ai generated contract', () => {
  it('accepts valid generated poll output', () => {
    const output = generatedPollSchema.parse({
      title: 'AI Generated Poll',
      isAnonymous: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      isPublished: false,
      questions: [{ text: 'Choose one option', options: ['A', 'B'], isMandatory: true }],
    });
    expect(output.questions.length).toBe(1);
  });
});
```

```ts
// tests/mvp.smoke.test.ts  (excerpt — pattern: swap model statics, call service, restore)
import { describe, expect, it } from 'bun:test';
import { PollService } from '../src/modules/polls/polls.service';
import { PollModel } from '../src/modules/polls/polls.model';
import { AnalyticsModel } from '../src/modules/responses/analytics.model';

describe('backend mvp smoke tests', () => {
  it('creates a poll through PollService', async () => {
    const originalCreate = PollModel.create;
    const originalAnalyticsCreate = AnalyticsModel.create;
    (PollModel as any).create = async (data: unknown) => data;
    (AnalyticsModel as any).create = async (data: unknown) => data;

    const created = await PollService.createPoll(
      {
        title: 'Backend MVP Poll',
        isAnonymous: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        isPublished: true,
        questions: [{ text: 'Best runtime?', options: ['Bun', 'Node'], isMandatory: true }],
      },
      'mock-creator-id-123',
    );

    expect((created as any).creatorId).toBe('mock-creator-id-123');
    (PollModel as any).create = originalCreate;
    (AnalyticsModel as any).create = originalAnalyticsCreate;
  });
});
```

### F.6 — `scratch/check_imports.js` (dev utility)
```js
import fs from 'fs';
import path from 'path';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk('src');
files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('ApiError') && !content.includes('import { ApiError }') && !content.includes('export class ApiError')) {
        console.log(`Missing import in ${file}`);
    }
});
```

---

## Part G — The LLM-Wiki / Context-Router System

This is the "docs/wiki + Cursor rules + hook" system that keeps an LLM (Cursor/Claude)
loading **only the minimal docs** per task instead of the whole repo, and **auto-logs**
every chat prompt. Three pieces:

### G.1 — The wiki (`backend/docs/wiki/`)
Small, single-purpose Markdown files, each with **YAML frontmatter**:
```markdown
---
summary: One-line description used to decide relevance.
status: active
last_updated: 2026-05-11
---

# Title
...short, implementation-focused content...
```

**The router file (`context-router.md`) is the brain** — it maps a *task type* to the exact
docs to load. Read this file first, every chat:
```markdown
---
summary: Minimal-context routing guide for loading only required docs per task.
status: active
last_updated: 2026-05-11
---

# Context Router

Read this file first in every new chat. Then load only the mapped docs for the current task.

## Core baseline (always allowed)
- backend/docs/wiki/project-overview.md
- backend/docs/wiki/api-conventions.md

## Route by task type
### Poll lifecycle tasks
- backend/docs/wiki/modules/polls.md
- backend/docs/wiki/api/polls.md
### Response validation and analytics tasks
- backend/docs/wiki/modules/responses.md
- backend/docs/wiki/api/responses.md
### Realtime Socket/Redis tasks
- backend/docs/wiki/realtime/socket-events.md
- backend/docs/wiki/realtime/redis-channels.md
### AI generation tasks
- backend/docs/wiki/modules/ai.md
- backend/docs/wiki/ai/structured-output-contract.md
- backend/docs/wiki/ai/prompting-and-graph-flow.md
### Setup and readiness tasks
- backend/docs/wiki/setup/local-dev.md
- backend/docs/wiki/mvp-checklist.md

## Hard rule
- Do not preload all wiki docs.
- Load only one task branch at a time.
- Add docs only if blocked by missing context.
```

**Doc taxonomy** (each is tiny and focused):
- `project-overview.md` — what the product is + MVP scope.
- `backend-architecture.md` — module boundaries + the 3 flows (HTTP/error/realtime).
- `api-conventions.md` — controller/service/validation/error rules.
- `how-to-run-limited-context.md` — copy-paste starter prompt for a new chat.
- `decision-log.md` — dated architecture decisions.
- `mvp-checklist.md` — completion checklist.
- `chat-log.md` — **auto-appended** prompt audit trail (see hook below).
- `modules/<x>.md` — per-module behavior + guarantees.
- `api/<x>.md` — per-module endpoint contracts.
- `realtime/*.md` — socket events + redis channels.
- `ai/*.md` — prompt flow + structured-output contract.
- `setup/local-dev.md` — local bring-up steps.

### G.2 — Cursor rules (`.cursor/rules/*.mdc`)
`.mdc` = Markdown + frontmatter. `alwaysApply: true` injects the rule into every request.

`.cursor/rules/llm-context-router.mdc`:
```markdown
---
description: Enforce minimal wiki context loading per task
alwaysApply: true
---

# LLM Context Router Rule

Use controlled context from `backend/docs/wiki/` only.

## Mandatory read order
1. Read `backend/docs/wiki/context-router.md`.
2. Read only the core docs listed for the matched task type.
3. Read one module/API doc only if required by the current task.
4. Do not read unrelated docs.

## Task routing
- Poll CRUD or lifecycle -> polls core set.
- Voting rules or aggregation -> responses core set.
- Socket/Redis live analytics -> realtime core set.
- AI generation -> ai core set.
- Infra/setup/test -> setup and checklist docs.

## Update policy
- If behavior or API contracts change, update only impacted wiki pages.
- Append one concise entry to `backend/docs/wiki/chat-log.md` per completed chat task.
```

`.cursor/rules/use-bun.mdc`:
```markdown
---
description: Use Bun for package management and scripts in this repo
alwaysApply: true
---

# Use Bun

- Use **Bun** instead of Node, npm, yarn, or pnpm for installs, scripts, and CLI tasks in this workspace.
- Prefer: `bun install`, `bun run <script>`, `bun test`, `bunx <tool>`.
- Do not default to `npm install`, `npm run`, or `npx` unless a task is documented as incompatible with Bun.
```

### G.3 — The prompt-logging hook
`.cursor/hooks.json` registers a `beforeSubmitPrompt` hook (`failClosed: false` = never
block a prompt if the hook errors):
```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": ".cursor/hooks/log-chat-prompt.mjs",
        "failClosed": false
      }
    ]
  }
}
```

`.cursor/hooks/log-chat-prompt.mjs` — reads the prompt from stdin, derives a `taskHint` by
keyword, and appends one line to `chat-log.md`. **Run with Bun.**
```js
#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const raw = await new Response(Bun.stdin.stream()).text();

let input = {};
try { input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }

const findPromptText = (value) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const preferredKeys = ["prompt", "userPrompt", "message", "input", "query", "text"];
  for (const key of preferredKeys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findPromptText(child);
    if (found) return found;
  }
  return "";
};

const fullPrompt = findPromptText(input).replace(/\s+/g, " ").trim();
const preview = fullPrompt ? fullPrompt.slice(0, 180) : "no-prompt-found";

let taskHint = "general";
const lower = fullPrompt.toLowerCase();
if (lower.includes("poll")) taskHint = "polls";
if (lower.includes("response") || lower.includes("vote")) taskHint = "responses";
if (lower.includes("socket") || lower.includes("redis") || lower.includes("realtime")) taskHint = "realtime";
if (lower.includes("ai") || lower.includes("langchain") || lower.includes("langgraph") || lower.includes("gemini")) taskHint = "ai";
if (lower.includes("setup") || lower.includes("docker") || lower.includes("test")) taskHint = "setup";

const logPath = resolve(process.cwd(), "backend/docs/wiki/chat-log.md");
const logDir = dirname(logPath);
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

const entry = `- ${new Date().toISOString()} | ${preview} | ${taskHint}\n`;
appendFileSync(logPath, entry, "utf8");

const output = { permission: "allow" };  // must echo a permission decision
process.stdout.write(JSON.stringify(output));
```

`.cursor/settings.json` (workspace plugins):
```json
{
  "plugins": {
    "redis-development": {
      "enabled": true
    }
  }
}
```

### G.4 — How it all works together (the loop)
1. You open a new chat. The always-on `llm-context-router.mdc` rule tells the LLM to read
   `context-router.md` first, then only the mapped docs for the task type.
2. `beforeSubmitPrompt` fires → `log-chat-prompt.mjs` derives a `taskHint` and appends
   `timestamp | preview | hint` to `chat-log.md`. (`failClosed:false` → harmless if it errors.)
3. The LLM works using minimal context, and per the update policy, edits only the impacted
   wiki page + appends a decision/chat entry. The wiki stays small and current → next chat
   stays cheap.

**For a new backend:** keep this entire system; just rewrite the *task branches* in
`context-router.md` + `llm-context-router.mdc` and the keyword map in the hook to match your
new domains.

---

## Part H — Cross-Cutting Patterns

These recur everywhere — apply them in any new module.

1. **Response envelope.** Success `{ success:true, message, data }` via `ApiResponse`;
   error `{ success:false, message }` via `errorHandler`. Never hand-roll `res.json`.
2. **Throw, don't return errors.** Services `throw ApiError.x(...)`; controllers wrap in
   `try/catch` and call `next(error)`. One global handler maps to HTTP status.
3. **Validate at the edge.** `validate(schema)` runs before the controller and replaces
   `req.body` with parsed values. Controllers/services trust the body shape.
4. **Static service classes.** No DI container; `class XService { static async ... }`.
   Stateless, easy to mock in tests by swapping statics.
5. **Typed requests.** `AuthRequest` carries `req.user`. `authenticate()` required,
   `authenticate(true)` optional, `authorize('admin')` for roles.
6. **Secrets hashed at rest.** Passwords (bcrypt), refresh/verify/reset tokens (sha256).
   Email the raw token, store the hash, compare hashes.
7. **`select:false` sensitive fields.** Must explicitly `.select('+field')` to read.
8. **Write-behind for hot counters.** Redis absorbs writes; a `setInterval` worker batches
   to Mongo via `bulkWrite` + `arrayFilters`, then busts cache + publishes.
9. **Cache-aside reads.** Read model checks Redis cache → falls back to Mongo → writes
   cache with TTL. Worker deletes the cache key on each flush.
10. **Realtime via Redis pub/sub bridge.** Publisher and subscriber share `events.ts`
    contracts; subscriber re-emits to `room_<id>`. Scales horizontally.
11. **Graceful degradation.** Missing email key → log mock. Missing AI key → mock draft.
    AI error → mock, never 500. App always boots/runs in dev with empty `.env`.
12. **Self-healing aggregates.** If the analytics doc is missing on read, rebuild it from
    the source poll. Cascade create/update/delete to keep aggregate in sync.
13. **Health vs readiness.** `/health` = process alive. `/ready` = dependencies (Mongo +
    Redis) connected. Container/orchestrator probes the right one.

---

## Part I — Replication Checklist for a New Backend

Say your new backend is for domain **"orders"** (replace with yours).

**Skeleton (copy verbatim):**
- [ ] Copy `.cursor/` (rules + hooks + hook script + settings).
- [ ] Copy root `docker-compose.yml`, `docker.ps1`, `README.md` (rename service/host labels).
- [ ] Copy `backend/` config files: `package.json` (trim unused deps), `tsconfig.json`,
      `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example` (edit vars), `index.ts`.
- [ ] Copy **all of `src/common/`** unchanged (rename log emoji/prefix if you like).
- [ ] Copy `src/app.ts`; later edit the router imports + `app.use('/api/...')` lines.
- [ ] Copy `src/modules/auth/` unchanged if you need users; else delete.

**Domain (rewrite):**
- [ ] Create `src/modules/orders/` with `orders.{route,controller,service,model,schema}.ts`
      following the F.0 template.
- [ ] Define `OrderModel` (Mongoose schema + `IOrder` interface, `timestamps:true`).
- [ ] Define `createOrderSchema` / `updateOrderSchema` (Zod) + inferred types.
- [ ] Put all rules in `OrderService` (static methods, throw `ApiError`).
- [ ] Thin `OrderController` (try/catch → `next(error)`, ownership checks, `ApiResponse`).
- [ ] Wire routes: `authenticate()` → `validate(schema)` → controller.
- [ ] Register in `app.ts`: `import ordersRouter ...; app.use('/api/orders', ordersRouter)`.
- [ ] If you need live updates: add channel/event names + payload types to `events.ts`,
      add a `*.worker.ts` if you have hot counters, subscribe in `socket.ts`.
- [ ] Delete `src/modules/ai/` (and AI deps) unless you want AI generation.

**Wiki + rules (rewrite to match domains):**
- [ ] Rewrite `docs/wiki/context-router.md` task branches for your domains.
- [ ] Update `.cursor/rules/llm-context-router.mdc` routing list.
- [ ] Update the keyword→`taskHint` map in `.cursor/hooks/log-chat-prompt.mjs`.
- [ ] Write one `modules/<x>.md` + `api/<x>.md` per domain; keep them tiny + frontmattered.
- [ ] Reset `chat-log.md` to just its header.
- [ ] Refresh `project-overview.md`, `backend-architecture.md`, `decision-log.md`.

**Verify:**
- [ ] `bun install` → `cp .env.example .env` (fill values) → `docker compose up -d`.
- [ ] `bun run typecheck` clean.
- [ ] `bun run dev`; hit `GET /health` and `GET /ready`.
- [ ] `bun test` (add smoke tests that swap model statics like F.5).
```
