import { registerSlot } from "@/features/presentations/live/slots";
import { EndScreenLink } from "./components/EndScreenLink";

/**
 * Plugs the sessions module into the live surfaces: a link on both end
 * screens, to the host's session reports and to a participant's own results.
 * Imported for its side effects through `features/registrations.ts`.
 */
registerSlot("endScreen", { id: "sessions:end-link", order: 100, Component: EndScreenLink });
