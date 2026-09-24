import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Cryptographically random base62 id. Uses rejection sampling so every character is
 * uniformly distributed (a 20-char game id carries ~119 bits of entropy: unguessable).
 */
export function randomId(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += ALPHABET[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Public player id derived from the browser's private secret. Deterministic per game, so a
 * player keeps their seat, vote and facilitator rights across reloads and reconnects,
 * while the secret itself is never exposed to other players (one-way hash).
 */
export function derivePlayerId(roomId: string, secret: string): string {
  return createHash('sha256').update(`${roomId}:${secret}`).digest('base64url').slice(0, 16);
}
