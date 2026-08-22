import { Router } from "express";
import { downloadStoredFile } from "../controllers/fileController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.use(protect);
router.get("/download", downloadStoredFile);

export default router;
