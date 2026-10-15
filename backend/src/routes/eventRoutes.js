import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { streamUserEvents } from "../services/liveEventsService.js";

const router = Router();

// Server-sent events for the signed-in person (liveEventsService). The browser reads it with
// fetch so the usual Authorization header applies.
router.get("/", protect, streamUserEvents);

export default router;
