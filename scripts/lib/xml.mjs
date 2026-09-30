// Minimal XML well-formedness checker (no dependencies).
// Catches what actually goes wrong when hand-editing SVG: unclosed or mismatched
// tags, stray "<", unescaped "&", malformed or duplicate attributes.
const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const BARE_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export function xmlErrors(src) {
  const errors = [];
  const stack = [];
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt === -1 ? src.length : lt);
    const amp = BARE_AMP.exec(text);
    if (amp) errors.push(`line ${lineOf(i + amp.index)}: unescaped "&" in text`);
    if (lt === -1) break;

    const skip = (open, close) => {
      if (!src.startsWith(open, lt)) return false;
      const end = src.indexOf(close, lt + open.length);
      if (end === -1) { errors.push(`line ${lineOf(lt)}: unterminated ${open}`); i = src.length; }
      else i = end + close.length;
      return true;
    };
    if (skip('<!--', '-->') || skip('<![CDATA[', ']]>') || skip('<?', '?>') || skip('<!', '>')) continue;

    TAG.lastIndex = lt;
    const m = TAG.exec(src);
    if (!m) {
      errors.push(`line ${lineOf(lt)}: malformed tag near ${JSON.stringify(src.slice(lt, lt + 40))}`);
      i = lt + 1;
      continue;
    }
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) errors.push(`line ${lineOf(lt)}: </${name}> closes <${open ?? 'nothing'}>`);
    } else {
      const seen = new Set();
      for (const a of attrs.matchAll(ATTR)) {
        if (seen.has(a[1])) errors.push(`line ${lineOf(lt)}: duplicate attribute ${a[1]} on <${name}>`);
        seen.add(a[1]);
        if (BARE_AMP.test(a[2] ?? a[3])) errors.push(`line ${lineOf(lt)}: unescaped "&" in ${a[1]}`);
      }
      if (!selfClosing) stack.push(name);
    }
    i = lt + m[0].length;
  }
  if (stack.length) errors.push(`unclosed element(s): ${stack.join(' > ')}`);
  return errors;
}
