// A person's initials on a colour derived from their id (or name), so the same person always
// looks the same everywhere. Decorative: the name is always written next to it.
const HUES = [348, 18, 38, 152, 174, 204, 228, 262, 290, 322];

export function initialsOf(name = "") {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

export function avatarHue(seed = "") {
  let hash = 0;
  for (const character of String(seed)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

export default function Avatar({ name, id, size = "md", className = "" }) {
  return (
    <span className={`avatar avatar-${size} ${className}`.trim()} style={{ "--avatar-hue": avatarHue(id || name) }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
