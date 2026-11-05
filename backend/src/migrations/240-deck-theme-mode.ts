import type { Migration } from './runner';

/**
 * Light deck themes: every deck stores whether it is drawn light or dark
 * (`presentation.theme.mode`). Until now every deck was dark, so a deck keeps
 * what it already showed only when someone chose its look on purpose:
 *
 * 1. A deck without a mode that picked another preset than Graph paper, a
 *    brand kit or an accent override: `dark` (the look its owner chose, on the
 *    dark stage it was made for).
 * 2. Every other deck without a mode (the plain default look): `light`, the
 *    new default, like the app.
 *
 * Workspace templates are decks and follow the same rules. Sessions keep their
 * theme snapshot (a running session is not restyled).
 *
 * Raw collection operations with the preset ids as they were when modes came
 * (later preset changes must not change what this did); idempotent: both
 * steps only touch decks that still have no mode.
 */
const CHOSEN_PRESETS = ['ocean', 'forest', 'grape', 'mono', 'classic'];

/** Sets theme.mode, also on a deck whose `theme` is missing or null (decks copied before themes existed). */
const withMode = (mode: 'light' | 'dark') => [
  { $set: { theme: { $mergeObjects: [{ $ifNull: ['$theme', {}] }, { mode }] } } },
];

const migration: Migration = {
  id: 240,
  name: 'deck-theme-mode',
  async up({ db, log }) {
    const decks = db.collection('presentations');
    const noMode = { 'theme.mode': { $exists: false } };

    const chosen = await decks.updateMany(
      {
        ...noMode,
        $or: [
          { 'theme.presetId': { $in: CHOSEN_PRESETS } },
          { 'theme.brandKitId': { $nin: [null] } },
          { 'theme.overrides': { $nin: [null] } },
        ],
      },
      withMode('dark')
    );
    log(`  presentations: theme.mode dark on ${chosen.modifiedCount} deck(s) with a chosen look`);

    const plain = await decks.updateMany(noMode, withMode('light'));
    log(`  presentations: theme.mode light on ${plain.modifiedCount} deck(s) with the default look`);
  },
};

export default migration;
