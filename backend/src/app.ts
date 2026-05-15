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
app.use(errorHandler);

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