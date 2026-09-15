import { asyncHandler } from "../middleware/asyncHandler.js";
import { countUnreadNotifications, listUserNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notificationService.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES } from "../utils/constants.js";

export const listNotifications = asyncHandler(async (req, res) => {
  const [data, unreadCount] = await Promise.all([
    listUserNotifications(req.user._id, { unreadOnly: req.query.unreadOnly === "true", limit: req.query.limit }),
    countUnreadNotifications(req.user._id)
  ]);
  res.json({ data, unreadCount });
});

export const readNotification = asyncHandler(async (req, res) => {
  const data = await markNotificationRead(req.params.id, req.user._id);
  if (!data) throw new AppError(404, "Notification not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  res.json({ data });
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  const result = await markAllNotificationsRead(req.user._id);
  res.json({ data: { modifiedCount: result.modifiedCount } });
});
