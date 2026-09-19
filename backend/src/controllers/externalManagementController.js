import { asyncHandler } from "../middleware/asyncHandler.js";
import { managementSnapshot } from "../services/externalManagementService.js";

export const getManagementSection = (section) => asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=15");
  res.json(await managementSnapshot(section, req.query));
});
