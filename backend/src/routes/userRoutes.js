import { Router } from "express";
import { createUser, deleteUser, getAccessReview, getMyLeave, getUser, getUserHistory, listMyTeam, listUsers, updateMyLeave, updateMyNotificationPreferences, updateUser } from "../controllers/userController.js";
import { authorizePermission, protect } from "../middleware/auth.js";
import { PERMISSIONS } from "../utils/constants.js";

const router = Router();

router.get("/my-team", protect, listMyTeam);
router.get("/me/leave", protect, getMyLeave);
router.put("/me/leave", protect, updateMyLeave);
router.put("/me/notification-preferences", protect, updateMyNotificationPreferences);
// Administración > Empleados / Roles y permisos (the administrator).
router.use(protect, authorizePermission(PERMISSIONS.EMPLOYEE_MANAGE));
router.get("/access-review", getAccessReview);
router.route("/").get(listUsers).post(authorizePermission(PERMISSIONS.ROLE_MANAGE), createUser);
router.get("/:id/history", getUserHistory);
router.route("/:id").get(getUser).put(updateUser).delete(deleteUser);

export default router;
