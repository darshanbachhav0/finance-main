import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

const MAX_PAGE_SIZE = 100;

export function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize, 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function parseSort(query = {}, allowedFields = [], fallback = { createdAt: -1 }) {
  const field = allowedFields.includes(query.sortBy) ? query.sortBy : null;
  if (!field) return fallback;
  return { [field]: String(query.sortDirection).toLowerCase() === "asc" ? 1 : -1 };
}

export function paginatedPayload(data, total, page, pageSize) {
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

export function escapedRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Notification and task deep links (?record=<id>, ?request=<id>, ?batch=<id>) narrow a list to
// the linked record. `fields` maps each accepted parameter to the document field it filters.
// Values are cast to ObjectIds so the filter also works inside aggregation pipelines.
export function deepLinkFilter(query = {}, fields = { record: "_id", request: "request" }) {
  const filter = {};
  for (const [param, field] of Object.entries(fields)) {
    const value = query[param];
    if (!value || !field) continue;
    if (!/^[a-f0-9]{24}$/i.test(String(value))) {
      throw new AppError(422, "The linked record is not valid.", { [param]: String(value) }, ERROR_CODES.VALIDATION_ERROR);
    }
    filter[field] = new mongoose.Types.ObjectId(String(value));
  }
  return filter;
}

// ANDs the deep-link filter into an existing Mongo query without disturbing its other clauses.
export function withDeepLink(query, queryParams, fields) {
  const filter = deepLinkFilter(queryParams, fields);
  if (Object.keys(filter).length) query.$and = [...(query.$and || []), filter];
  return query;
}
