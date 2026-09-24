import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { login, me, register, changePassword } from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many failed sign-in attempts. Try again in 15 minutes." }
});

router.post("/login", loginLimiter, login);
if (process.env.NODE_ENV !== "production") router.post("/register", register);
router.get("/me", protect, me);
router.post("/change-password", loginLimiter, protect, changePassword);

export default router;
