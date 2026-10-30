/* A small subset of JSON Schema: just enough for the two schemas under schema/.
 *
 * No ajv: the CLI must start with `npx` and zero dependencies. Only the keywords the schemas actually use are recognized
 * (type / required / properties / additionalProperties / items / anyOf / $ref / minimum / maximum).
 * If a schema adds another keyword this throws: better loud than silently letting things pass.
 */
type Schema = Record<string, any>;
export interface SchemaError { path: string; message: string }

const KNOWN = new Set([
  '$schema', '$id', '$defs', 'title', 'description',
  'type', 'required', 'properties', 'additionalProperties', 'items', 'anyOf', '$ref', 'minimum', 'maximum',
]);

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const fits = (v: unknown, t: string) => { const a = typeOf(v); return a === t || (t === 'number' && a === 'integer'); };

export function checkSchema(root: Schema, value: unknown, limit = 50): SchemaError[] {
  const resolve = (s: Schema): Schema => (s.$ref ? root.$defs[s.$ref.replace('#/$defs/', '')] : s);
  const walk = (s0: Schema, v: unknown, path: string, out: SchemaError[]): void => {
    if (out.length >= limit) return;
    const s = resolve(s0);
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`schema-check: unsupported keyword "${k}"`);
    if (s.type) {
      const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => fits(v, t))) { out.push({ path, message: `expected ${types.join(' or ')}, got ${typeOf(v)}` }); return; }
    }
    if (s.anyOf && !s.anyOf.some((alt: Schema) => { const e: SchemaError[] = []; walk(alt, v, path, e); return !e.length; })) {
      const req = s.anyOf.map((a: Schema) => a.required?.map((r: string) => `"${r}"`).join(' + ')).filter(Boolean);
      out.push({ path, message: req.length ? `needs ${req.join(', or ')}` : 'matches none of the allowed shapes' });
    }
    if (typeOf(v) === 'object') {
      const o = v as Record<string, unknown>;
      for (const r of s.required ?? []) if (!(r in o)) out.push({ path, message: `missing "${r}"` });
      for (const [k, val] of Object.entries(o)) {
        const sub = s.properties?.[k] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : null);
        if (sub) walk(sub, val, `${path}.${k}`, out);
        else if (s.additionalProperties === false) out.push({ path, message: `unknown field "${k}"` });
      }
    }
    if (typeOf(v) === 'array' && s.items) (v as unknown[]).forEach((x, i) => walk(s.items, x, `${path}[${i}]`, out));
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) out.push({ path, message: `must be ≥ ${s.minimum}` });
      if (s.maximum != null && v > s.maximum) out.push({ path, message: `must be ≤ ${s.maximum}` });
    }
  };
  const out: SchemaError[] = [];
  walk(root, value, '$', out);
  return out;
}
