/** Session retention choices for /settings/workspace (backend: `settings.retentionDays`, capped by the plan). */

export const RETENTION_DAYS = [30, 90, 180, 365, 730, 1095] as const;

export interface RetentionOption {
  /** null = as long as the plan allows. */
  days: number | null;
  label: string;
}

const daysLabel = (days: number) => (days % 365 === 0 ? `${days / 365} year${days === 365 ? "" : "s"}` : `${days} days`);

/**
 * The choices the plan allows, shortest first, ending with "as long as the
 * plan allows" (forever when the plan has no limit). A stored value that is not
 * a standard choice stays selectable.
 */
export function retentionOptions(planLimit: number | null, current: number | null): RetentionOption[] {
  const days = new Set<number>(RETENTION_DAYS.filter((d) => planLimit === null || d < planLimit));
  if (current !== null && (planLimit === null || current < planLimit)) days.add(current);
  return [
    ...[...days].sort((a, b) => a - b).map((d) => ({ days: d, label: daysLabel(d) })),
    { days: null, label: planLimit === null ? "Forever" : `${daysLabel(planLimit)} (the plan's longest)` },
  ];
}

/** How the current setting reads to members who can't change it. */
export function retentionText(planLimit: number | null, current: number | null): string {
  const effective = current === null ? planLimit : planLimit === null ? current : Math.min(current, planLimit);
  return effective === null ? "Kept until deleted" : `Kept for ${daysLabel(effective)} after a session ends`;
}
