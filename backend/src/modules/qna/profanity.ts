/**
 * Minimal profanity mask for audience questions, until W2-A lands the shared
 * `common/utils/profanity.ts` (switch this module to it then). Whole words
 * only, case-insensitive, with simple letter-for-digit substitutions; a match
 * is replaced by asterisks of the same length, so the question stays readable
 * and the list never shows up in an error message.
 */

const WORDS = [
  'arsehole',
  'asshole',
  'bastard',
  'bitch',
  'bollocks',
  'bullshit',
  'cock',
  'cunt',
  'dick',
  'dickhead',
  'fag',
  'faggot',
  'fuck',
  'fucked',
  'fucker',
  'fucking',
  'motherfucker',
  'nigga',
  'nigger',
  'prick',
  'pussy',
  'retard',
  'shit',
  'shitty',
  'slut',
  'twat',
  'wanker',
  'whore',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

const BLOCKED = new Set(WORDS);

const normalize = (word: string) =>
  word
    .toLowerCase()
    .replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch)
    // "fuuuck" → "fuck"
    .replace(/(.)\1{2,}/g, '$1');

// Letters, digits and the substitution symbols form a word.
const WORD_RE = /[\p{L}\p{N}@$]+/gu;

/** True when `text` contains a blocked word. */
export const containsProfanity = (text: string): boolean => {
  for (const match of text.matchAll(WORD_RE)) {
    if (BLOCKED.has(normalize(match[0]))) return true;
  }
  return false;
};

/** `text` with every blocked word replaced by asterisks. */
export const maskProfanity = (text: string): string =>
  text.replace(WORD_RE, (word) => (BLOCKED.has(normalize(word)) ? '*'.repeat(word.length) : word));
