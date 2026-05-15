# Open Poll Platform 🥟

_The intelligent, real-time polling platform that helps you capture sentiments and harvest actionable AI-powered insights instantly._

## 💡 Inspiration

We live in a world overflowing with data, yet gathering real-time, meaningful feedback remains surprisingly difficult. Traditional forms and polls are static, boring, and require manual analysis. We wanted to build a platform that not only captures votes instantly but also uses AI to understand the _why_ behind the choices.

## 🚀 What it does

Open Poll is a modern, full-stack polling application that offers:

- **Instant Real-time Polling**: Cast your vote and watch the charts update live for everyone connected, powered by WebSockets.
- **AI-Powered Analytics**: We don't just count votes. Our built-in AI analyzes responses to generate intelligent summaries and spot emerging trends.
- **Engaging User Experience**: A beautiful, highly responsive, and accessible UI that makes participating in polls feel delightful instead of like a chore.
- **Seamless Authentication**: Jump right in using Google OAuth or traditional email/password login.

## 🛠️ How we built it

We utilized a cutting-edge modern web stack designed for speed, scale, and developer experience:

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Shadcn UI, and Framer Motion for buttery-smooth animations.
- **Backend**: Bun for an ultra-fast runtime, Express.js for our API, and Socket.io for low-latency, real-time bidirectional communication.
- **Database & Caching**: MongoDB (with Mongoose) for flexible document storage, and Redis to handle fast socket session management and caching.
- **AI Integration**: Custom AI modules integrated into the backend architecture to process and summarize poll data on the fly.
- **DevOps & Architecture**: Fully Dockerized environments with Docker Compose for absolute "it works on my machine (and production)" reliability.

## 🚧 Challenges we ran into

- Managing state synchronization and preventing race conditions when hundreds of users vote simultaneously in real-time.
- Structuring prompt engineering to ensure the AI provides unbiased, strictly analytical insights rather than hallucinations based on poll text.
- Integrating a seamless monorepo-like feel with separate Dockerfiles for the Next.js frontend and Express/Bun backend while keeping hot-reloading active.

## 🏆 Accomplishments that we're proud of

- Successfully orchestrating the real-time syncing between Redis, MongoDB, and Next.js clients.
- Delivering a gorgeous, polished UI that feels incredibly responsive.
- Building the entire platform to be 100% Dockerized and VPS-deployment ready from day one.

## 🎓 What we learned

- The immense power and speed of Bun when used in a containerized full-stack environment.
- How to efficiently pipe real-time socket events natively into Next.js React Server Components and client hooks.
- How to effectively utilize Redis as an adapter for scaling Socket.io nodes.

## 🚀 What's next for Open Poll

- **Granular AI Reports**: Generating full-page PDF/CSV analytical reports with AI charts.
- **Anonymous/Guest Polling**: Expanding access limits using device fingerprinting instead of strict auth.
- **Poll branching**: Dynamic polls where the next question depends on previous answers.

---

## 💻 Local Development

### Prerequisites

- [Bun](https://bun.sh/) installed.
- Docker (for Redis and MongoDB).

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd open_poll
```

### 2. Set up Environment Variables

- Create `backend/.env` (copy from `backend/.env.example`).
- Create `frontend/.env.local` (copy from `frontend/.env.example`).

### 3. Run with Docker Compose (Recommended)

You can run the entire stack (Frontend, Backend, Redis, Mongo) with a single command:

```bash
docker-compose up --build
```

_Or on Windows:_

```powershell
./docker.ps1
```

### 4. Manual Run (Without Docker Compose)

If you prefer to run services manually:

**Backend:**

```bash
cd backend
bun install
bun dev
```

**Frontend:**

```bash
cd frontend
bun install
bun dev
```

---

## 🌐 VPS Deployment Architecture

Deploying to a VPS is easy with Docker. We designed `docker-compose.yml` to orchestrate:

1. Clone the repo onto your VPS.
2. Update the `docker-compose.yml` with your VPS IP address in the `frontend` build arguments.
3. Update your `backend/.env` with production secrets and your VPS IP.
4. Run:

```bash
sudo docker compose up --build -d
```

---

## 📄 License

MIT License.
