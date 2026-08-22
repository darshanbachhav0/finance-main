import { ERROR_CODES } from "./constants.js";

export class AppError extends Error {
  constructor(statusCode, message, details = undefined, code = ERROR_CODES.VALIDATION_ERROR) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}
