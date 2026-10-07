import { Router } from "express";
import { createUser, deleteUser, getMyLeave, listMyTeam, listUsers, updateMyLeave, updateUser } from "../controllers/userController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.get("/my-team", protect, listMyTeam);
router.get("/me/leave", protect, getMyLeave);
router.put("/me/leave", protect, updateMyLeave);
router.use(protect, authorize(ROLES.ADMIN));
router.route("/").get(listUsers).post(createUser);
router.route("/:id").put(updateUser).delete(deleteUser);

export default router;
