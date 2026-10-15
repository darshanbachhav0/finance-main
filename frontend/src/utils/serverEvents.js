// One server-sent event block ("event: x\ndata: {...}") as { event, data }, or null when it carries
// no JSON data (comments such as the ": ping" heartbeat).
export function parseServerEvent(block) {
  let event = "message";
  const data = [];
  for (const line of String(block || "").split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try { return { event, data: JSON.parse(data.join("\n")) }; } catch { return null; }
}
