// Small brand illustrations for empty and finished states. Colours come from the theme tokens
// (lively.css), so they follow light and dark mode. Always decorative.
const drawings = {
  empty: (
    <>
      <ellipse className="ill-shadow" cx="60" cy="80" rx="38" ry="5" />
      <path className="ill-soft" d="M22 44 L34 22 H86 L98 44 V72 a4 4 0 0 1 -4 4 H26 a4 4 0 0 1 -4 -4 Z" />
      <path className="ill-paper" d="M40 14 H80 V50 H40 Z" />
      <path className="ill-line" d="M47 24 H73 M47 31 H73 M47 38 H64" />
      <path className="ill-tray" d="M22 44 H44 l5 9 H71 l5 -9 H98 V72 a4 4 0 0 1 -4 4 H26 a4 4 0 0 1 -4 -4 Z" />
      <circle className="ill-accent" cx="98" cy="18" r="3" />
      <circle className="ill-accent-soft" cx="20" cy="26" r="2.5" />
    </>
  ),
  search: (
    <>
      <ellipse className="ill-shadow" cx="60" cy="80" rx="34" ry="5" />
      <path className="ill-paper" d="M28 12 H74 L86 24 V74 H28 Z" />
      <path className="ill-line" d="M37 28 H66 M37 36 H70 M37 44 H58" />
      <circle className="ill-lens" cx="70" cy="56" r="13" />
      <path className="ill-handle" d="M79 65 L92 78" />
      <circle className="ill-accent" cx="22" cy="20" r="3" />
    </>
  ),
  done: (
    <>
      <ellipse className="ill-shadow" cx="60" cy="81" rx="30" ry="5" />
      <circle className="ill-soft" cx="60" cy="44" r="30" />
      <circle className="ill-success" cx="60" cy="44" r="21" />
      <path className="ill-check" d="M50 44 l7 7 l14 -15" />
      <path className="ill-spark" d="M20 22 v8 M16 26 h8 M98 16 v8 M94 20 h8 M100 58 v6 M97 61 h6" />
      <circle className="ill-accent" cx="26" cy="62" r="3" />
    </>
  )
};

export default function Illustration({ name = "empty", size = 120, className = "" }) {
  return (
    <svg className={`illustration ${className}`.trim()} width={size} height={Math.round(size * 0.75)} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      {drawings[name] || drawings.empty}
    </svg>
  );
}
