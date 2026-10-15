export const CELEBRATE_EVENT = "uma:celebrate";

// A short, purely visual celebration for a milestone (a request approved, paid, a rendition
// validated). The action's own toast still announces the result to screen readers.
export function celebrate(message = "") {
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { message } }));
}
