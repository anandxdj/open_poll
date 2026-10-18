import { Router } from 'express';

// W2-B (Q&A + reactions) adds the participant routes; src/http/routes.ts mounts this router at /api/presentations/:presentationId/qna.
const router = Router({ mergeParams: true });

// W2-B: host moderation, mounted at /api/presentations/:presentationId/host/qna.
export const qnaHostRouter = Router({ mergeParams: true });

export default router;
