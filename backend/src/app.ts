import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { connectDB } from './common/config/db';
import { connectRedis } from './common/config/redis';
import pollsRouter from './modules/polls/polls.route';
import responsesRouter from './modules/responses/responses.route';
import aiRouter from './modules/ai/ai.route';
import { errorHandler } from './common/middlewares/errorHandler';
import mongoose from 'mongoose';
import { redisClient } from './common/config/redis';
import { initSocketGateway } from './common/realtime/socket.gateway';

const app = express();
const httpServer = createServer(app);

// Global Middlewares
app.use(cors());
app.use(express.json());

initSocketGateway(httpServer);

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

app.use('/api/polls', pollsRouter);
app.use('/api/responses', responsesRouter);
app.use('/api/ai', aiRouter);
app.use(errorHandler);

// Boot Server & Connect Services
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, async () => {
  await connectDB();
  await connectRedis();
  console.log(`[Server] Running on port ${PORT}`);
});