import { Router } from 'express';
import participantRouter from './routes/participant.route';
import crudRouter from './routes/crud.route';
import hostRouter from './routes/host.route';

// Mounted at /api/presentations (and /api/quizzes as a legacy alias). One
// sub-router per concern; order is match order (public participant routes first).
const router = Router();

router.use(participantRouter);
router.use(crudRouter);
router.use(hostRouter);

export default router;
