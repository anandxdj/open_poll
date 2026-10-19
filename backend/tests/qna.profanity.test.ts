import { describe, expect, it } from 'bun:test';
import { containsProfanity, maskProfanity } from '../src/modules/qna/profanity';

describe('Q&A profanity filter', () => {
  it('masks whole blocked words with asterisks of the same length', () => {
    expect(maskProfanity('what the fuck is this')).toBe('what the **** is this');
    expect(maskProfanity('Shit happens')).toBe('**** happens');
  });

  it('is case-insensitive and sees simple letter-for-digit substitutions', () => {
    expect(containsProfanity('SHIT')).toBe(true);
    expect(maskProfanity('sh1t and b1tch')).toBe('**** and *****');
    expect(containsProfanity('a$$hole')).toBe(true);
    expect(containsProfanity('@sshole')).toBe(true);
  });

  it('collapses stretched letters', () => {
    expect(maskProfanity('fuuuuck this')).toBe('******* this');
  });

  it('leaves innocent words that merely contain a blocked one', () => {
    for (const text of ['Scunthorpe', 'class assessment', 'cocktail', 'Dickens wrote novels', 'shiitake']) {
      expect(containsProfanity(text)).toBe(false);
      expect(maskProfanity(text)).toBe(text);
    }
  });

  it('keeps punctuation, spacing and non-latin text untouched', () => {
    expect(maskProfanity('Why, bullshit? Really!')).toBe('Why, ********? Really!');
    expect(maskProfanity('¿Por qué?  日本語')).toBe('¿Por qué?  日本語');
  });
});
