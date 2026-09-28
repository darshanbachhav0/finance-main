// Deep copy of a lean/plain record for API payloads. structuredClone would turn every
// ObjectId into a raw { buffer } object (it copies own properties, not the class), so ids
// would reach the browser as "[object Object]". ObjectIds and Dates are kept as instances.
export function plainClone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value._bsontype === "ObjectId" || value._bsontype === "ObjectID") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(plainClone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainClone(item)]));
}
