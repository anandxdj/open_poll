import type { Locale } from "./config";
import type { Messages } from "./messages";

// Types every `useTranslations(namespace)` key against the English messages.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
