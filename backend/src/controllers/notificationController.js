import { asyncHandler } from "../middleware/asyncHandler.js";
import { createEmailTransport } from "../integrations/email/index.js";
import { recordAudit } from "../services/auditService.js";
import { isValidEmail, sendTestNotificationEmail } from "../services/notificationEmailService.js";
import { countUnreadNotifications, dismissNotification, listUserNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notificationService.js";
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

export const dismissOneNotification = asyncHandler(async (req, res) => {
  const data = await dismissNotification(req.params.id, req.user._id);
  if (!data) throw new AppError(404, "Notification not found.", { id: req.params.id }, ERROR_CODES.NOT_FOUND);
  res.json({ data });
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  const result = await markAllNotificationsRead(req.user._id);
  res.json({ data: { modifiedCount: result.modifiedCount } });
});

// Administrators check the email setup from the app (no server shell needed, e.g. Render free):
// one sample email to their own address, or to "to" when given.
export const sendTestEmail = asyncHandler(async (req, res) => {
  const to = isValidEmail(req.body?.to) ? String(req.body.to).trim() : req.user.email;
  if (!isValidEmail(to)) throw new AppError(422, "Your account has no email address. Add one in User Administration, or send the test to another address.", { field: "to" }, ERROR_CODES.VALIDATION_ERROR);
  try {
    const data = await sendTestNotificationEmail({ to, createTransport: createEmailTransport });
    await recordAudit({ entityType: "User", entity: req.user, action: "NOTIFICATION_TEST_EMAIL_SENT", user: req.user, req, module: "USER_ADMIN", newValues: { to: data.to, transport: data.transport } });
    res.json({ data });
  } catch (error) {
    throw new AppError(502, `Test email failed: ${error?.message || error}${error?.hint ? ` ${error.hint}` : ""}`, { hint: error?.hint || undefined }, ERROR_CODES.VALIDATION_ERROR);
  }
});
