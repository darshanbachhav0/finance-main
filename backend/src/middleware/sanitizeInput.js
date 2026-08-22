import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

function assertSafeKeys(value, path = "body") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      throw new AppError(400, "Input contains an unsupported field name.", { path: `${path}.${key}` }, ERROR_CODES.VALIDATION_ERROR);
    }
    assertSafeKeys(child, `${path}.${key}`);
  }
}

export function sanitizeInput(req, _res, next) {
  assertSafeKeys(req.body, "body");
  assertSafeKeys(req.query, "query");
  next();
}

