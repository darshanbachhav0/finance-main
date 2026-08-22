process.env.NODE_ENV = "production";
process.env.PORT ||= "5174";

const gatewayOrigin = process.env.PUBLIC_GATEWAY_URL || "https://uma-financial-access.onrender.com";
const configuredOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
process.env.CLIENT_URLS = [...new Set([...configuredOrigins, gatewayOrigin])].join(",");

await import("./server.js");
