import { Router } from "express";
import { listNotifications, readAllNotifications, readNotification } from "../controllers/notificationController.js";
import { protect } from "../middleware/auth.js";

const router = Router();
router.use(protect);
router.get("/", listNotifications);
router.patch("/read-all", readAllNotifications);
router.patch("/:id/read", readNotification);

export default router;

