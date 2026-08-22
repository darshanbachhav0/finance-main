import cors from "cors";
import express from "express";
import fs from "fs";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { sanitizeInput } from "./middleware/sanitizeInput.js";
import routes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";

const app = express();

if (isProduction) app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5174,http://127.0.0.1:5174")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedDevOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):5174$/.test(origin);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: null
      }
    }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      const allowed = isProduction ? (!origin || allowedOrigins.includes(origin)) : isAllowedDevOrigin(origin);
      if (allowed) return callback(null, true);
      return callback(new Error("CORS origin is not allowed."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "2mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || "2mb" }));
app.use(sanitizeInput);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "erp-financial-backend" });
});

app.use("/api", routes);

if (isProduction) {
  const frontendDist = path.resolve(__dirname, "..", "..", "frontend", "dist");
  const frontendIndex = path.join(frontendDist, "index.html");

  if (!fs.existsSync(frontendIndex)) {
    throw new Error("Frontend production build is missing. Run npm run build before starting the public server.");
  }

  app.use(express.static(frontendDist, { index: false, maxAge: "1d" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || req.path.startsWith("/generated/") || req.path === "/health") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(frontendIndex);
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
