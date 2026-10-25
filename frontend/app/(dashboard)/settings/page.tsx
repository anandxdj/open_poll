import { redirect } from "next/navigation";
import { SETTINGS_HOME } from "@/features/workspaces/settings/sections";

// /settings has no content of its own; each section is its own page.
export default function SettingsPage() {
  redirect(SETTINGS_HOME);
}
