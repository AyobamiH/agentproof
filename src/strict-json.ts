export function parseJsonStrict(raw: string): unknown {
  let index = 0;
  const whitespace = () => { while (/\s/.test(raw[index] ?? "")) index += 1; };
  const fail = (message: string): never => { throw new SyntaxError(`strict_json:${message}:offset:${index}`); };
  const parseString = (): string => {
    if (raw[index] !== '"') fail("string_expected");
    const start = index++;
    let escaped = false;
    while (index < raw.length) {
      const char = raw[index++];
      if (!escaped && char === '"') {
        try { return JSON.parse(raw.slice(start, index)) as string; } catch { fail("invalid_string"); }
      }
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
      if (!escaped && char.charCodeAt(0) < 0x20) fail("control_character");
    }
    return fail("unterminated_string");
  };
  const parseValue = (): unknown => {
    whitespace();
    const char = raw[index];
    if (char === '"') return parseString();
    if (char === "{") {
      index += 1;
      whitespace();
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (raw[index] === "}") { index += 1; return result; }
      while (true) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) fail(`duplicate_key:${key}`);
        keys.add(key);
        whitespace();
        if (raw[index++] !== ":") fail("colon_expected");
        result[key] = parseValue();
        whitespace();
        const separator = raw[index++];
        if (separator === "}") return result;
        if (separator !== ",") fail("object_separator_expected");
      }
    }
    if (char === "[") {
      index += 1;
      whitespace();
      const result: unknown[] = [];
      if (raw[index] === "]") { index += 1; return result; }
      while (true) {
        result.push(parseValue());
        whitespace();
        const separator = raw[index++];
        if (separator === "]") return result;
        if (separator !== ",") fail("array_separator_expected");
      }
    }
    const rest = raw.slice(index);
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (rest.startsWith(literal)) { index += literal.length; return value; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) return fail("value_expected");
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("non_finite_number");
    return number;
  };
  const value = parseValue();
  whitespace();
  if (index !== raw.length) fail("trailing_content");
  return value;
}
