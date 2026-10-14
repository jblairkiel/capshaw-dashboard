import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import LoginPage from '../components/LoginPage';

// The privacy policy and terms of service are plain HTML files in
// client/public, so that Google's and Facebook's URL checks, which do not run
// JavaScript, can read them.
const read = name => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public', name), 'utf8');
const privacy = read('privacy.html');
const terms   = read('terms.html');

describe.each([
  ['privacy.html', privacy, 'Privacy Policy'],
  ['terms.html',   terms,   'Terms of Service'],
])('%s', (_name, html, title) => {
  test('is readable without JavaScript', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`<h1>${title}</h1>`);
  });

  test('uses the shared stylesheet', () => {
    expect(html).toContain('<link rel="stylesheet" href="/legal.css">');
  });
});

describe('privacy policy', () => {
  test('has the data-deletion section Facebook links to', () => {
    expect(privacy).toContain('id="delete"');
    expect(privacy).toMatch(/Deleting your account/);
  });

  test('says what Google and Facebook share with us', () => {
    expect(privacy).toMatch(/sign in with Google or Facebook/);
    expect(privacy).toMatch(/name, your\s+email address, a link to your profile picture/);
  });
});

describe('terms of service', () => {
  test('asks members to keep church information within the church family', () => {
    expect(terms).toMatch(/Keep what you see here within the church family/);
  });

  test('points to the privacy policy for what we receive and how to delete an account', () => {
    expect(terms).toContain('href="/privacy.html"');
    expect(terms).toContain('href="/privacy.html#delete"');
  });
});

describe('sign-in page', () => {
  test('links to both pages', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy.html');
    expect(screen.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms.html');
  });
});
