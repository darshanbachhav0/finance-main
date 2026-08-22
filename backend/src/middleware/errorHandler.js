import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, undefined, ERROR_CODES.NOT_FOUND));
}

export function errorHandler(error, _req, res, _next) {
  let statusCode = error.statusCode || 500;
  let code = error.code && typeof error.code === "string" ? error.code : ERROR_CODES.VALIDATION_ERROR;
  let message = error.message || "Internal server error";
  let details = error.details;

  if (error.code === 11000) {
    statusCode = 409;
    code = Object.keys(error.keyPattern || {}).some((key) => key.includes("fiscalData") || key.includes("voucher"))
      ? ERROR_CODES.DUPLICATE_VOUCHER
      : ERROR_CODES.CONFLICT;
    message = code === ERROR_CODES.DUPLICATE_VOUCHER
      ? "The supplier voucher is already registered."
      : "Duplicate value violates a unique constraint.";
    details = error.keyValue;
  }

  if (error.name === "ValidationError") {
    statusCode = 422;
    code = ERROR_CODES.VALIDATION_ERROR;
    message = "Validation failed.";
    details = Object.values(error.errors).map((item) => ({ field: item.path, message: item.message }));
  }

  if (statusCode >= 500 && !error.isOperational) {
    message = "Internal server error";
    code = "INTERNAL_ERROR";
    details = undefined;
  }

  const payload = { success: false, code, message, details: details || {} };
  if (process.env.NODE_ENV !== "production" && statusCode >= 500) payload.stack = error.stack;
  res.status(statusCode).json(payload);
}
