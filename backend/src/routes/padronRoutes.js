import { Router } from "express";
import { protect, authorizePermission } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getSunatPadronStatus } from "../services/sunatPadronService.js";
import { PERMISSIONS } from "../utils/constants.js";
const router = Router();
router.use(protect, authorizePermission(PERMISSIONS.PLATFORM_MANAGE));
router.get("/status", asyncHandler(async (_req,res) => res.json({data:await getSunatPadronStatus()})));
export default router;
