import mongoose from "mongoose";

// A comment on a request's conversation thread: a question or an answer that does not change the
// request's status (observing or returning it still goes through the approval actions). Comments
// are append-only, like the rest of the request's history.
const requestCommentSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialRequest", required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    // People mentioned with @: each was able to view the request when the comment was posted.
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

requestCommentSchema.index({ request: 1, createdAt: 1 });

export default mongoose.model("RequestComment", requestCommentSchema);
