import * as React from "react";

const subscribe = () => () => {};

/**
 * `false` on the server and during hydration, `true` once rendering on the
 * client. Use it to gate output that depends on client-only state (e.g. the
 * resolved theme) without a mount effect.
 */
function useMounted() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export { useMounted };
