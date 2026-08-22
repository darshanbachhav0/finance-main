import { Router } from "express";
import { createUser, deleteUser, listUsers, updateUser } from "../controllers/userController.js";
import { authorize, protect } from "../middleware/auth.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(protect, authorize(ROLES.ADMIN));
router.route("/").get(listUsers).post(createUser);
router.route("/:id").put(updateUser).delete(deleteUser);

export default router;
