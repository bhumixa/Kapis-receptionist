import { PasswordService } from '../../../src/modules/auth/application/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes using argon2id with the documented production parameters', async () => {
    const hash = await service.hash('Str0ngP@ss!');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=4');
  });

  it('round-trips: a hash verifies against the password that produced it', async () => {
    const hash = await service.hash('correct-horse-battery-staple1A');
    await expect(
      service.verify(hash, 'correct-horse-battery-staple1A'),
    ).resolves.toBe(true);
  });

  it('rejects an incorrect password against a real hash', async () => {
    const hash = await service.hash('correct-horse-battery-staple1A');
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('produces a different hash for the same password on each call (random salt)', async () => {
    const [a, b] = await Promise.all([
      service.hash('Str0ngP@ss!'),
      service.hash('Str0ngP@ss!'),
    ]);
    expect(a).not.toEqual(b);
  });
});
