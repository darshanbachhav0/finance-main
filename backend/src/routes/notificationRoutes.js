import { Router } from "express";
import { dismissOneNotification, listNotifications, readAllNotifications, readNotification } from "../controllers/notificationController.js";
import { protect } from "../middleware/auth.js";

const router = Router();
router.use(protect);
router.get("/", listNotifications);
router.patch("/read-all", readAllNotifications);
router.patch("/:id/read", readNotification);
router.patch("/:id/dismiss", dismissOneNotification);

export default router;

