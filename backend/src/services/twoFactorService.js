import crypto from "node:crypto";
import { getJwtSecret } from "../config/secrets.js";

// Authenticator-app sign-in (TOTP, RFC 6238: SHA-1, 6 digits, 30-second steps), as used by Google
// Authenticator, Microsoft Authenticator and similar apps. Mandatory for the Super Admin.
const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept the previous and next step too, for clocks that drift a little.
const WINDOW = 1;
const ISSUER = "UMA Finanzas";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpCode(secret, step = totpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

// The step the code belongs to, or null. A step at or before lastUsedStep is refused, so a code
// that was already used (or an older one) cannot be replayed.
export function verifyTotp(secret, code, { lastUsedStep, now = Date.now() } = {}) {
  const value = String(code || "").replace(/\s/g, "");
  if (!secret || !/^\d{6}$/.test(value)) return null;
  const current = totpStep(now);
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const step = current + offset;
    if (lastUsedStep !== undefined && lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))) return step;
  }
  return null;
}

export function otpauthUri(secret, accountName) {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Secrets are stored encrypted (AES-256-GCM). TWO_FACTOR_ENCRYPTION_KEY keeps them readable
// across JWT secret rotations; without it the key derives from the JWT secret, and rotating that
// secret means re-enrolling (npm run superadmin:reset-2fa).
function encryptionKey() {
  const material = process.env.TWO_FACTOR_ENCRYPTION_KEY || `uma-two-factor:${getJwtSecret()}`;
  return crypto.createHash("sha256").update(material).digest();
}

export function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload) {
  const [version, iv, tag, data] = String(payload || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
