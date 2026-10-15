// People's names are stored as the UMA roster writes them: first surname, second surname, first
// name, second name ("QUISPE MAMANI MARÍA ELENA"), sometimes with a comma between the surnames and
// the names ("QUISPE MAMANI, MARÍA ELENA"). Greetings address a person by their first name:
// "María". Shared by the dashboard greeting and the notification emails.

// Particles belong to the word after them, so "DE LA CRUZ" is one surname and
// "MARÍA DE LOS ÁNGELES" keeps "María" as the first name.
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos", "di", "san", "santa", "van", "von"]);
const LOCALE = "es-PE";

function parts(text) {
  const result = [];
  let pending = [];
  for (const word of String(text || "").trim().split(/\s+/).filter(Boolean)) {
    if (PARTICLES.has(word.toLocaleLowerCase(LOCALE))) { pending.push(word); continue; }
    result.push([...pending, word].join(" "));
    pending = [];
  }
  if (pending.length) {
    if (result.length) result[result.length - 1] += ` ${pending.join(" ")}`;
    else result.push(pending.join(" "));
  }
  return result;
}

// "QUISPE" -> "Quispe", "DE LA CRUZ" -> "de la Cruz", "O'BRIEN" -> "O'Brien". A name written in
// mixed case already has its own capitals and is kept.
function capitalize(text) {
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text.toLocaleLowerCase(LOCALE).split(" ").map((word) => (PARTICLES.has(word) ? word : word.replace(/(^|['-])(\p{L})/gu, (match, separator, letter) => separator + letter.toLocaleUpperCase(LOCALE)))).join(" ");
}

const sentenceStart = (text) => text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);

// The first name: "QUISPE MAMANI MARÍA ELENA" -> "María" (the third part, after both surnames;
// "DE LA CRUZ" counts as one surname). After a comma it is the first part ("QUISPE MAMANI, MARÍA
// ELENA"); with two words the roster order is surname then name ("TORRES ANA" -> "Ana"); one word
// is used as it is. Account labels with a note in brackets ("Contabilidad UMA (Demo)") are not
// roster names: they are greeted by their first word.
export function greetingName(name = "") {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  if (!value) return "";
  if (/[()]/.test(value)) return sentenceStart(capitalize(value.split(" ")[0]));
  const [, givenText] = value.includes(",") ? value.split(",", 2) : [];
  let firstName;
  if (givenText?.trim()) {
    firstName = parts(givenText)[0];
  } else {
    const words = parts(value.replace(/,/g, " "));
    firstName = words.length === 1 ? words[0] : words.length === 2 ? words[1] : words[2];
  }
  return sentenceStart(capitalize(firstName));
}
