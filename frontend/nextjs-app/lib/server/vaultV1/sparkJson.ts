/** Small bounded JSON reader preserving numeric tokens until protocol validation.
 * JSON.parse rounds int64 transaction IDs and sub-cent decimals before a reviver. */
export class SparkJsonNumber { constructor(readonly raw: string) {} }
export function parseSparkJson(source: string): unknown {
  let position = 0;
  const fail = (): never => { throw new Error("Invalid Spark JSON"); };
  const whitespace = () => { while (/[\t\n\r ]/.test(source[position] ?? "x")) position++; };
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      const character = source[position++];
      if (character === "\\") position++;
      else if (character === '"') return JSON.parse(source.slice(start, position));
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 16) return fail();
    whitespace();
    const character = source[position];
    if (character === '"') return string();
    if (character === "{" || character === "[") {
      position++; whitespace();
      const map = Object.create(null) as Record<string, unknown>, list: unknown[] = [];
      const end = character === "{" ? "}" : "]";
      if (source[position] === end) { position++; return character === "{" ? map : list; }
      for (;;) {
        if (character === "{") {
          if (source[position] !== '"') return fail();
          const key = string(); whitespace();
          if (Object.hasOwn(map, key) || source[position++] !== ":") return fail();
          map[key] = value(depth + 1);
        } else list.push(value(depth + 1));
        whitespace();
        const delimiter = source[position++];
        if (delimiter === end) return character === "{" ? map : list;
        if (delimiter !== ",") return fail();
        whitespace();
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, position)) { position += literal.length; return result; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(position))?.[0];
    if (!token) return fail();
    position += token.length;
    return new SparkJsonNumber(token);
  };
  const result = value(0); whitespace();
  if (position !== source.length) return fail();
  return result;
}

/** Exact integer cents from a JSON numeric token, including exponent notation. */
export function sparkMoneyCents(value: unknown): number | null {
  if (!(value instanceof SparkJsonNumber)) return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value.raw);
  if (!match) return null;
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) return null;
  const fraction = match[2] ?? "";
  const power = 2 + exponent - fraction.length;
  if (Math.abs(power) > 100) return null;
  let integer = BigInt(match[1] + fraction);
  if (power >= 0) integer *= 10n ** BigInt(power);
  else {
    const divisor = 10n ** BigInt(-power);
    if (integer % divisor !== 0n) return null;
    integer /= divisor;
  }
  return integer > 0n && integer <= 99999999n ? Number(integer) : null;
}
