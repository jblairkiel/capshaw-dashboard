import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import LoginPage from '../components/LoginPage';

// The privacy policy is a plain HTML file (client/public/privacy.html) so that
// Facebook's URL check, which does not run JavaScript, can read it.
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public/privacy.html'), 'utf8');

describe('privacy policy', () => {
  test('is readable without JavaScript', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<h1>Privacy Policy</h1>');
  });

  test('has the data-deletion section Facebook links to', () => {
    expect(html).toContain('id="delete"');
    expect(html).toMatch(/Deleting your account/);
  });

  test('says what Google and Facebook share with us', () => {
    expect(html).toMatch(/sign in with Google or Facebook/);
    expect(html).toMatch(/name, your\s+email address, a link to your profile picture/);
  });

  test('is linked from the sign-in page', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy.html');
  });
});
