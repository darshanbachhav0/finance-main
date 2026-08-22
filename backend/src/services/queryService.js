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

