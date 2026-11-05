import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { FoldersController } from './folders.controller';
import { createFolderSchema, moveItemsSchema, renameFolderSchema } from './folders.schema';

/**
 * Library folders (W3-B2), mounted at /api/folders by src/http/routes.ts. Every
 * route runs in the X-Workspace-Id workspace (workspaceContext()), like the
 * library and the deck routes.
 * - GET    /          the workspace's folders with item counts
 * - POST   /          { name } create a folder
 * - POST   /move      { folderId | null, items: [{ entityType, id }] } file decks and polls
 * - PATCH  /:id       { name } rename
 * - DELETE /:id       delete; its items move to the top level, its shares are removed
 */
const router = Router();

const byUser = (req: Request) => (req as AuthRequest).user?.id;
const writeLimit = rateLimit({ prefix: 'folders-write', windowSec: 60, max: 120, keyBy: byUser });

router.get('/', authenticate(), workspaceContext(), FoldersController.list);
router.post('/', authenticate(), workspaceContext(), writeLimit, validate(createFolderSchema), FoldersController.create);
router.post('/move', authenticate(), workspaceContext(), writeLimit, validate(moveItemsSchema), FoldersController.move);
router.patch('/:id', authenticate(), workspaceContext(), writeLimit, validate(renameFolderSchema), FoldersController.rename);
router.delete('/:id', authenticate(), workspaceContext(), writeLimit, FoldersController.remove);

export default router;
