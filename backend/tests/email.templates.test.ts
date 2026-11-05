import { describe, expect, test } from 'bun:test';

import { emailLayout } from '../src/common/config/emailLayout';

describe('email layout', () => {
  const html = emailLayout({
    heading: 'Verify your email',
    body: '<p>Body copy</p>',
    button: { href: 'https://example.test/verify/abc', label: 'Verify email' },
    footer: 'Footer note',
  });

  test('uses the brand colours and names the product correctly', () => {
    expect(html).toContain('#cf460c');
    expect(html).toContain('Open Poll');
    expect(html).not.toContain('OpenPoll');
    expect(html).not.toContain('#d8ad87');
  });

  test('renders the heading, body, button and footer', () => {
    expect(html).toContain('Verify your email</h1>');
    expect(html).toContain('<p>Body copy</p>');
    expect(html).toContain('href="https://example.test/verify/abc"');
    expect(html).toContain('Verify email</a>');
    expect(html).toContain('Footer note');
  });

  test('leaves the button out when there is none', () => {
    expect(emailLayout({ heading: 'H', body: 'B', footer: 'F' })).not.toContain('</a></td></tr></table>');
  });
});
