/**
 * Feature modules that plug into the live surfaces — live sub-reducers
 * (`registerLiveReducer`) and slot entries (`registerSlot`). Imported for its
 * side effects by the host console and the participant shell, so every
 * registration runs before their first render.
 *
 * Append-only: one side-effect import per module, alphabetical, e.g.
 *   import "@/features/qna/register";
 *
 * See frontend/docs/wiki/features/live-surfaces.md.
 */
import "@/features/qna/register";
import "@/features/reactions/register";
import "@/features/sessions/register";
