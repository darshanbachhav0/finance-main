const INSECURE_DEFAULT_JWT_SECRET = "dev_secret_change_me";

// A hardcoded fallback secret would let anyone who has read this source file
// forge a valid token for any user (including Admin) on a deployment that
// forgot to configure JWT_SECRET. The fallback stays available for local
// development and tests (where no real credentials are at risk), but a
// production process must fail fast instead of silently signing/verifying
// tokens with a publicly-known secret.
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production. Refusing to sign or verify tokens with a public default secret.");
  }
  return INSECURE_DEFAULT_JWT_SECRET;
}
