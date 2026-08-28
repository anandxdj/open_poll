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
import { startLiveDistributionWorker } from './modules/presentations/liveDistribution.worker';
import cookieParser from 'cookie-parser';
import authRouter from './modules/auth/auth.route';
import presentationsRouter from './modules/presentations/presentations.route';
import mcpRouter from './modules/mcp/mcp.route';
import mcpSettingsRouter from './modules/mcp/mcp.settings.route';
import { mongoSanitize, securityHeaders } from './common/middlewares/security.middleware';
import { AuthController } from './modules/auth/auth.controller';

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Global Middlewares
app.use(securityHeaders);
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ].filter(Boolean) as string[];
    // Allow requests with no origin (e.g. curl, Postman, server-side)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(mongoSanitize);

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

// Registered OIDC redirect URI. Token exchange and ID-token validation happen
// here before the browser is sent back to the frontend.
app.get('/auth/callback', AuthController.oidcCallback as any);

app.use('/api/auth', authRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/responses', responsesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/presentations', presentationsRouter);
app.use('/api/quizzes', presentationsRouter);
app.use('/api/mcp', mcpSettingsRouter);
app.use('/mcp', mcpRouter);
app.use(errorHandler);

// Boot Server & Connect Services
const PORT = process.env.PORT || 5000;
const bootstrap = async () => {
  await connectDB();
  await connectRedis();
  await setupSocketAndPubSub(io);
  startAnalyticsWorker();
  startLiveDistributionWorker();

  httpServer.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
  });
};

void bootstrap();
