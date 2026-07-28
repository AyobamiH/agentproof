import { createHash } from "node:crypto";

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical_json_non_finite_number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("canonical_json_cycle");
    seen.add(value);
    const result = value.map((item) => {
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new TypeError("canonical_json_non_json_array_value");
      }
      return canonicalize(item, seen);
    });
    seen.delete(value);
    return result;
  }
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("canonical_json_plain_object_required");
    if (seen.has(value)) throw new TypeError("canonical_json_cycle");
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new TypeError("canonical_json_non_json_object_value");
      }
      result[key] = canonicalize(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError("canonical_json_non_json_value");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(value: unknown): string {
  return sha256(stableJson(value));
}
