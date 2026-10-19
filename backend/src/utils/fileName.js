// Browsers send file names in UTF-8, but the multipart parser reads them as Latin-1, so
// "Años.png" arrives as "AÃ±os.png". The bytes are read again as UTF-8 when they form valid
// UTF-8; a name that is already proper Unicode, or plain ASCII, is kept as it is.
export function utf8FileName(name) {
  const value = String(name ?? "");
  if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("�") ? value : decoded;
}

// A stored name that looks like UTF-8 read as Latin-1 (e.g. "Ã±", "Ã³", "Â°").
export const looksMisdecoded = (name) => /[Â-ß][\u0080-¿]/.test(String(name ?? ""));
