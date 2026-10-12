import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { changePassword, enableTwoFactor, login, loginTwoFactor, logout, me, platformStatus, refresh, register, setupTwoFactor } from "../controllers/authController.js";
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
// Second sign-in step for accounts with an authenticator app (the Super Admin).
router.post("/login/two-factor", loginLimiter, loginTwoFactor);
// Maintenance notice and announcement for the sign-in page; no session needed.
router.get("/platform-status", platformStatus);
if (process.env.NODE_ENV !== "production") router.post("/register", register);
router.get("/me", protect, me);
router.post("/logout", protect, logout);
// Issues a fresh token for a session that is still valid (see authController.refresh).
router.post("/refresh", protect, refresh);
router.post("/change-password", loginLimiter, protect, changePassword);
router.post("/two-factor/setup", protect, setupTwoFactor);
router.post("/two-factor/enable", loginLimiter, protect, enableTwoFactor);

export default router;
