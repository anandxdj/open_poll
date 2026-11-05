import { ScimError } from './scim.errors';

/** One `attribute eq "value"` comparison. */
export interface ScimCondition {
  attribute: string;
  value: string | boolean;
}

const CONDITION = /^\s*([A-Za-z][\w.:]*)\s+eq\s+(?:"((?:[^"\\]|\\.)*)"|(true|false))\s*$/i;

/**
 * Parses the filters identity providers send for lookups: `eq` comparisons,
 * optionally joined by `and` (`userName eq "a@b.c"`, `externalId eq "x" and
 * active eq true`). Anything else is 400 invalidFilter.
 */
export function parseScimFilter(filter: string | undefined, allowed: readonly string[]): ScimCondition[] {
  if (!filter || !filter.trim()) return [];
  if (filter.length > 1000) throw new ScimError(400, 'Filter is too long', 'invalidFilter');
  const parts = filter.split(/\s+and\s+/i);
  return parts.map((part) => {
    const match = CONDITION.exec(part);
    if (!match) throw new ScimError(400, `Unsupported filter: ${part.trim()}`, 'invalidFilter');
    const attribute = match[1]!.replace(/^urn:ietf:params:scim:schemas:core:2\.0:(User|Group):/i, '');
    const known = allowed.find((name) => name.toLowerCase() === attribute.toLowerCase());
    if (!known) throw new ScimError(400, `Filtering on ${attribute} is not supported`, 'invalidFilter');
    const value = match[3] !== undefined ? match[3].toLowerCase() === 'true' : match[2]!.replace(/\\(.)/g, '$1');
    return { attribute: known, value };
  });
}

/** `startIndex` (1-based) and `count` (default 100, at most 200). */
export function scimPage(query: Record<string, unknown>) {
  const startIndex = Math.max(1, Number.parseInt(String(query.startIndex ?? '1'), 10) || 1);
  const rawCount = Number.parseInt(String(query.count ?? '100'), 10);
  const count = Math.min(200, Math.max(0, Number.isNaN(rawCount) ? 100 : rawCount));
  return { startIndex, count };
}
