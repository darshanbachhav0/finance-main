import { Router } from "express";
import { searchRecords } from "../controllers/searchController.js";
import { protect } from "../middleware/auth.js";

const router = Router();
router.use(protect);
router.get("/", searchRecords);

export default router;
