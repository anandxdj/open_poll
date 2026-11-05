import { apiClient } from "@/lib/api-client";

// Templates (`/api/templates`, backend `modules/templates`): starter decks
// shipped with the app plus the workspace's own templates.

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface TemplateSummary {
  /** A slug for starter templates, a deck id for workspace templates. */
  id: string;
  source: "starter" | "workspace";
  title: string;
  /** Starter templates only (empty for workspace templates). */
  description: string;
  /** Starter templates only: Meetings, Events, Education, Company. */
  category: string | null;
  slideCount: number;
  /** Distinct slide types in deck order, at most six. */
  slideTypes: string[];
  /** Labels of the first slides. */
  outline: string[];
  pace: "presenter" | "audience";
  /** Workspace templates only. */
  createdBy: { id: string; name: string } | null;
  updatedAt: string | null;
}

export interface TemplateList {
  starter: TemplateSummary[];
  workspace: TemplateSummary[];
}

/** The deck a template call returns (only these fields are read). */
export interface CreatedDeck {
  _id: string;
  title: string;
}

/** Backend limit on a deck or template title. */
export const MAX_TEMPLATE_TITLE = 120;

export const listTemplates = async () => (await apiClient.get<ApiOk<TemplateList>>("/templates")).data.data;

/** "Save as template": a copy of the deck that only the templates page lists. */
export const saveAsTemplate = async (presentationId: string, title: string) =>
  (await apiClient.post<ApiOk<CreatedDeck>>("/templates", { presentationId, title })).data.data;

/** "Use template": a new draft deck in the current workspace. */
export const createDeckFromTemplate = async (templateId: string) =>
  (await apiClient.post<ApiOk<CreatedDeck>>(`/templates/${encodeURIComponent(templateId)}/use`)).data.data;

export const deleteTemplate = async (templateId: string) => {
  await apiClient.delete(`/templates/${encodeURIComponent(templateId)}`);
};

export const TEMPLATES_PATH = "/templates";
