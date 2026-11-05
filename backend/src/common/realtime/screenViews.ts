/**
 * Screen views (W4-D). A `screen` socket (a read-only stage joined with a
 * screen token) sits in the deck's `all` room and in its own `screen` room. It
 * gets a host-audience event only when the module that owns the event type
 * registered a view for it: a function that returns the payload a screen may
 * see (or null to skip that one). `deliverLiveEvent` emits that copy to the
 * screen room, so host-only data reaches a screen only through code that made
 * it safe, and never reaches participants.
 */
export type ScreenView = (payload: Record<string, unknown>) => Record<string, unknown> | null;

const views = new Map<string, ScreenView>();

/** Registers (or replaces) the screen view of one live event type. Returns the undo (tests). */
export const registerScreenView = (type: string, view: ScreenView): (() => void) => {
  const previous = views.get(type);
  views.set(type, view);
  return () => {
    if (views.get(type) !== view) return;
    if (previous) views.set(type, previous);
    else views.delete(type);
  };
};

export const getScreenView = (type: string): ScreenView | undefined => views.get(type);
