import { Router } from "express";
import { dismissOneNotification, listNotifications, readAllNotifications, readNotification, sendTestEmail } from "../controllers/notificationController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();
router.use(protect);
router.get("/", listNotifications);
router.patch("/read-all", readAllNotifications);
router.post("/test-email", authorize(ROLES.ADMIN), sendTestEmail);
router.patch("/:id/read", readNotification);
router.patch("/:id/dismiss", dismissOneNotification);

export default router;

