import { Router } from "express";
import { protect, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getSunatPadronStatus } from "../services/sunatPadronService.js";
import { ROLES } from "../utils/constants.js";
const router = Router();
router.use(protect, authorize(ROLES.ADMIN));
router.get("/status", asyncHandler(async (_req,res) => res.json({data:await getSunatPadronStatus()})));
export default router;
