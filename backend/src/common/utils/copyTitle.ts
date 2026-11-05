/**
 * Title of a duplicated deck or poll: "Copy of <title>", cut to `max` UTF-16
 * units (the request schemas count those) without leaving half a surrogate pair.
 */
export function copyTitle(title: string, max = Number.POSITIVE_INFINITY): string {
  let copy = `Copy of ${title.trim()}`;
  if (copy.length <= max) return copy;
  copy = copy.slice(0, max);
  const last = copy.charCodeAt(copy.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) copy = copy.slice(0, -1);
  return copy.trimEnd();
}
