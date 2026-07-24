import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Hash de senha/token com scrypt (nativo — sem dependências).
// Formato armazenado: "<salt-hex>:<derivado-hex>"
export function hashSecret(secret) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(secret), salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifySecret(secret, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(String(secret), salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
