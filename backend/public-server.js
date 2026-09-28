process.env.NODE_ENV = "production";
process.env.PORT ||= "5174";

// DEMO ONLY entry point (START_UMA_PUBLIC_FIXED.bat / scripts/share-cloudflare.ps1): serves the
// production build on this PC for a temporary tunnel. Production on Render uses `npm start`.
// PUBLIC_GATEWAY_URL is the tunnel origin the launcher detected; it is added to CORS if set.
const gatewayOrigin = String(process.env.PUBLIC_GATEWAY_URL || "").trim();
const configuredOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
process.env.CLIENT_URLS = [...new Set([...configuredOrigins, gatewayOrigin].filter(Boolean))].join(",");

await import("./server.js");
