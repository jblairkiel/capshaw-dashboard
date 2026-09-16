const {
  passwordProblem, hashPassword, verifyPassword, createToken, hashToken, MIN_LENGTH, MAX_LENGTH,
} = require('../lib/passwords');

// scrypt is deliberately slow, so give the round trips room.
jest.setTimeout(20000);

describe('passwordProblem', () => {
  test('accepts an ordinary long password', () => {
    expect(passwordProblem('harvest-oak-1963')).toBe('');
  });

  test('refuses anything shorter than the minimum', () => {
    expect(passwordProblem('a'.repeat(MIN_LENGTH - 1))).toMatch(/at least/);
    expect(passwordProblem('a'.repeat(MIN_LENGTH))).toBe('');
  });

  test('refuses an absurdly long one, so a stranger cannot choose our workload', () => {
    expect(passwordProblem('a'.repeat(MAX_LENGTH + 1))).toMatch(/no more than/);
  });

  test('refuses nothing at all', () => {
    expect(passwordProblem('')).toBeTruthy();
    expect(passwordProblem(undefined)).toBeTruthy();
    expect(passwordProblem(12345678901)).toBeTruthy();
  });

  test('refuses the obvious guesses', () => {
    expect(passwordProblem('password123')).toMatch(/too easy/);
    expect(passwordProblem('PassWord123')).toMatch(/too easy/);
  });

  test('refuses a password that is only the address or the name it protects', () => {
    expect(passwordProblem('patnolan1234', { email: 'patnolan1234@example.com' })).toMatch(/not your email/);
    expect(passwordProblem('patricianolan', { name: 'Patricia Nolan' })).toMatch(/not your name/);
  });
});

describe('hashPassword / verifyPassword', () => {
  test('a digest verifies against its own password and nothing else', async () => {
    const stored = await hashPassword('harvest-oak-1963');
    await expect(verifyPassword('harvest-oak-1963', stored)).resolves.toBe(true);
    await expect(verifyPassword('harvest-oak-1964', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  test('the password itself never appears in what is stored', async () => {
    const stored = await hashPassword('harvest-oak-1963');
    expect(stored).not.toContain('harvest-oak-1963');
  });

  test('salting means the same password hashes differently every time', async () => {
    const a = await hashPassword('harvest-oak-1963');
    const b = await hashPassword('harvest-oak-1963');
    expect(a).not.toBe(b);
    await expect(verifyPassword('harvest-oak-1963', b)).resolves.toBe(true);
  });

  test('the cost parameters travel with the digest, so they can be raised later', async () => {
    const [scheme, n, r, p, salt, digest] = (await hashPassword('harvest-oak-1963')).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt).toBeTruthy();
    expect(digest).toBeTruthy();
  });

  test('a corrupt or foreign digest fails rather than throwing', async () => {
    for (const stored of ['', 'not-a-hash', 'bcrypt$1$2$3$4$5', 'scrypt$x$8$1$c2FsdA==$aGFzaA==', null]) {
      await expect(verifyPassword('harvest-oak-1963', stored)).resolves.toBe(false);
    }
  });
});

describe('createToken', () => {
  test('hands back a token and a digest that is not the token', () => {
    const { token, hash } = createToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hash).not.toBe(token);
    expect(hash).toBe(hashToken(token));
  });

  test('is url-safe, so it survives being put in a link', () => {
    for (let i = 0; i < 20; i++) {
      expect(createToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createToken().token));
    expect(seen.size).toBe(200);
  });
});
