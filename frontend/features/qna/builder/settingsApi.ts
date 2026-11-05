import { apiClient } from "@/lib/api-client";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** The deck settings the Audience tab edits (`settings.qna`, `settings.reactions`, `settings.profanityFilter`). */
export interface AudienceSettings {
  qna: { enabled: boolean; moderation: boolean; anonymousAllowed: boolean; upvotes: boolean };
  reactions: { enabled: boolean; emojis: string[] };
  /** Mask profanity in word-cloud and open-ended answers (W2-A). */
  profanityFilter: boolean;
}

export const DEFAULT_AUDIENCE_SETTINGS: AudienceSettings = {
  qna: { enabled: false, moderation: false, anonymousAllowed: true, upvotes: true },
  reactions: { enabled: false, emojis: ["👍", "❤️", "😂", "😮", "👏"] },
  profanityFilter: false,
};

/** Emoji the builder offers; the deck allows at most `MAX_REACTION_EMOJIS` of them. */
export const REACTION_CHOICES = ["👍", "❤️", "😂", "😮", "👏", "🎉", "🤔", "🔥", "💡", "🙌", "😍", "😢"] as const;
export const MAX_REACTION_EMOJIS = 6;

type SettingsResponse = {
  settings?: {
    qna?: Partial<AudienceSettings["qna"]>;
    reactions?: Partial<AudienceSettings["reactions"]>;
    profanityFilter?: boolean;
  };
};

export async function getAudienceSettings(presentationId: string): Promise<AudienceSettings> {
  const { settings } = (await apiClient.get<ApiOk<SettingsResponse>>(`/presentations/${presentationId}`)).data.data;
  return {
    qna: { ...DEFAULT_AUDIENCE_SETTINGS.qna, ...settings?.qna },
    reactions: {
      enabled: settings?.reactions?.enabled ?? DEFAULT_AUDIENCE_SETTINGS.reactions.enabled,
      emojis: settings?.reactions?.emojis ?? DEFAULT_AUDIENCE_SETTINGS.reactions.emojis,
    },
    profanityFilter: settings?.profanityFilter ?? DEFAULT_AUDIENCE_SETTINGS.profanityFilter,
  };
}

export async function saveAudienceSettings(
  presentationId: string,
  patch: { qna?: Partial<AudienceSettings["qna"]>; reactions?: Partial<AudienceSettings["reactions"]>; profanityFilter?: boolean }
): Promise<void> {
  await apiClient.patch(`/presentations/${presentationId}`, { settings: patch });
}
