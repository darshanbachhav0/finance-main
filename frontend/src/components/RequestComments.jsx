import { AtSign, Loader2, MessageSquare, Send } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { timeAgo } from "../utils/timeAgo.js";
import { formatDateTime } from "../utils/formatters.js";
import Avatar from "./Avatar.jsx";
import EmptyState from "./EmptyState.jsx";

const MAX_LENGTH = 2000;
export const COMMENTS_CHANGED_EVENT = "uma:comments-changed";

// The text after the last "@" before the caret, while it is still a name being typed.
function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)@([\p{L}\p{M}.' -]{0,40})$/u);
  return match ? { start: before.length - match[2].length - 1, query: match[2] } : null;
}

// "@María Quispe" in a comment, for every person the comment mentions, is highlighted.
function CommentBody({ body, mentions }) {
  const names = mentions.map((item) => item.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <p className="comment-body">{body}</p>;
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return <p className="comment-body">{parts.map((part, index) => names.some((name) => part === `@${name}`) ? <mark key={index} className="comment-mention">{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</p>;
}

// A request's conversation: questions and answers that do not change its status. "@" suggests
// people who can view the request; they are notified, as are the requester and the pending approver.
export default function RequestComments({ requestId, canWrite = true }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const listId = useId();
  const textareaRef = useRef(null);
  const [comments, setComments] = useState(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState([]);
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState({ open: false, items: [], active: 0, start: 0, query: "" });

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/requests/${requestId}/comments`);
      setComments(response.data.data || []);
      setError("");
    } catch (err) { setError(err.message); }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);
  // Live updates (and the bell) announce new comments; reload when one arrives for this request.
  useEffect(() => {
    const reload = (event) => { if (!event.detail?.requestId || String(event.detail.requestId) === String(requestId)) load(); };
    window.addEventListener(COMMENTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(COMMENTS_CHANGED_EVENT, reload);
  }, [load, requestId]);

  // Suggestions for the name after "@", from the people who can view this request.
  useEffect(() => {
    if (!suggestions.open) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get(`/requests/${requestId}/comments/mentionable`, { params: { q: suggestions.query } });
        if (active) setSuggestions((current) => ({ ...current, items: response.data.data || [], active: 0 }));
      } catch { if (active) setSuggestions((current) => ({ ...current, items: [] })); }
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [suggestions.open, suggestions.query, requestId]);

  function onChange(event) {
    const text = event.target.value.slice(0, MAX_LENGTH);
    setBody(text);
    const query = mentionQuery(text, event.target.selectionStart ?? text.length);
    setSuggestions((current) => query ? { ...current, open: true, start: query.start, query: query.query } : { ...current, open: false, items: [] });
  }

  function pick(person) {
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, suggestions.start)}@${person.name} ${body.slice(caret)}`;
    setBody(next.slice(0, MAX_LENGTH));
    setMentions((current) => current.some((item) => item._id === person._id) ? current : [...current, person]);
    setSuggestions({ open: false, items: [], active: 0, start: 0, query: "" });
    window.requestAnimationFrame(() => {
      const position = suggestions.start + person.name.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event) {
    if (suggestions.open && suggestions.items.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSuggestions((current) => ({ ...current, active: (current.active + step + current.items.length) % current.items.length }));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(suggestions.items[suggestions.active]); return; }
      if (event.key === "Escape") { event.preventDefault(); setSuggestions((current) => ({ ...current, open: false })); return; }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); }
  }

  // Only the people still written in the text are mentioned.
  const activeMentions = useMemo(() => mentions.filter((person) => body.includes(`@${person.name}`)), [mentions, body]);

  async function send(event) {
    event?.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const response = await api.post(`/requests/${requestId}/comments`, { body, mentions: activeMentions.map((person) => person._id) });
      setComments((current) => [...(current || []), response.data.data]);
      setBody("");
      setMentions([]);
      notify(activeMentions.length ? "Comment posted. The people you mentioned were notified." : "Comment posted.");
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  }

  const activeOption = suggestions.open && suggestions.items.length ? `${listId}-option-${suggestions.active}` : undefined;

  return (
    <section className="workspace-panel request-comments" id="comments" aria-labelledby="request-comments-title">
      <div className="section-heading"><div><h3 id="request-comments-title"><MessageSquare size={18} aria-hidden="true" /> {t("Comments")}</h3><p>{t("Ask or answer a question without changing the request's status. Type @ to mention someone.")}</p></div></div>
      {error && <p className="field-error-text" role="alert">{error}</p>}
      {comments === null && !error && <p className="muted-text"><Loader2 className="spin" size={16} aria-hidden="true" /> {t("Loading comments...")}</p>}
      {comments?.length === 0 && <EmptyState compact title="No comments yet. Start the conversation." />}
      {comments?.length > 0 && (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment._id} className="comment-item">
              <Avatar name={comment.author?.name} id={comment.author?._id} />
              <div className="comment-content">
                <div className="comment-meta"><strong>{comment.author?.name || t("System")}</strong><span>{t(comment.author?.jobTitle || comment.author?.role || "")}</span><time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt, language)}>{timeAgo(comment.createdAt, language)}</time></div>
                <CommentBody body={comment.body} mentions={comment.mentions || []} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <form className="comment-composer" onSubmit={send}>
          <div className="comment-input">
            <textarea
              ref={textareaRef}
              rows={3}
              value={body}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onBlur={() => window.setTimeout(() => setSuggestions((current) => ({ ...current, open: false })), 150)}
              placeholder={t("Write a comment... Type @ to mention someone.")}
              aria-label={t("New comment")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(suggestions.open && suggestions.items.length)}
              aria-controls={listId}
              aria-activedescendant={activeOption}
              maxLength={MAX_LENGTH}
            />
            {suggestions.open && suggestions.items.length > 0 && (
              <ul className="mention-suggestions" id={listId} role="listbox" aria-label={t("People you can mention")}>
                {suggestions.items.map((person, index) => (
                  <li key={person._id} id={`${listId}-option-${index}`} role="option" aria-selected={index === suggestions.active} className={index === suggestions.active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); pick(person); }}>
                    <Avatar name={person.name} id={person._id} size="sm" /><span><strong>{person.name}</strong><small>{[person.jobTitle || t(person.role), person.area].filter(Boolean).join(" · ")}</small></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="comment-actions">
            <span className="muted-text">{activeMentions.length ? <><AtSign size={14} aria-hidden="true" /> {t("{count} will be notified").replace("{count}", activeMentions.map((person) => person.name).join(", "))}</> : t("Ctrl + Enter to send")}</span>
            <button type="submit" className="primary-button" disabled={!body.trim() || sending}><Send size={16} /><span>{t(sending ? "Sending..." : "Post comment")}</span></button>
          </div>
        </form>
      )}
    </section>
  );
}
