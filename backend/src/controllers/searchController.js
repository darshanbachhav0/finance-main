import { asyncHandler } from "../middleware/asyncHandler.js";
import { globalSearch } from "../services/globalSearchService.js";

// GET /api/search?q= - records the caller may open, grouped by type (see globalSearchService).
export const searchRecords = asyncHandler(async (req, res) => {
  res.json(await globalSearch(req.query.q, req.user));
});
