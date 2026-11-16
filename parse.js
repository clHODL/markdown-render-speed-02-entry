// parse.js — a dependency-free Markdown parser rendering exactly what
// marked 18.1.3 renders with its defaults (GFM on, breaks off).
// Written from the CommonMark 0.31.2 and GFM 0.29 specifications, with
// marked's observable behaviour (as shown by the practice set's expected
// outputs) as the arbiter wherever marked departs from the spec.
//
// Architecture: a line-based block parser builds a small block tree
// (containers: block quote / list / item; leaves: paragraph, heading,
// code, html, thematic break, table), link reference definitions are
// harvested when paragraphs close, and inline content is parsed per
// leaf with a delimiter-stack inline parser (CommonMark appendix A
// style: emphasis, links and strikethrough resolved from delimiter
// and bracket stacks).

// ---------------------------------------------------------------- utils

const ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

function isSpaceCh(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isWhitespaceStr(s) {
  for (let i = 0; i < s.length; i++) if (!isSpaceCh(s[i])) return false;
  return true;
}

// Unicode punctuation or symbol (CommonMark "punctuation character").
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isPunctCh(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return ASCII_PUNCT.indexOf(ch) >= 0;
  return PUNCT_RE.test(ch);
}

// Unicode whitespace, per CommonMark (space, tab, LF, FF, CR + Unicode Zs etc).
const WS_RE = /\s/u;
function isWsCh(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return WS_RE.test(ch);
}

function isDigitCh(ch) {
  return ch >= '0' && ch <= '9';
}

// Whitespace as the link grammar sees it: space, tab, newline, CR.
// (U+00A0 and other Unicode spaces are NOT separators in destinations
// or titles — they become part of the destination, percent-encoded.)
function isLinkWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

// ASCII punctuation (for backslash escapes: only ASCII punctuation can
// be escaped; a backslash before a non-ASCII character is literal).
function isAsciiPunctCh(ch) {
  return ch.length === 1 && ch.charCodeAt(0) < 128 && ASCII_PUNCT.indexOf(ch) >= 0;
}

function isAlphaCh(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAlnumCh(ch) {
  return isAlphaCh(ch) || isDigitCh(ch);
}

// Escape text content, entity-aware: &, <, >, ", '. A `&` that starts
// something shaped like an entity reference (&name; or &#...; /
// &#x...;) is left alone — marked passes named references through
// verbatim, even invented ones, and only decodes numeric references
// (done by the inline parser before escaping).
function escapeText(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let rep = null;
    if (ch === '&') {
      if (!looksLikeEntity(s, i)) rep = '&amp;';
    } else if (ch === '<') rep = '&lt;';
    else if (ch === '>') rep = '&gt;';
    else if (ch === '"') rep = '&quot;';
    else if (ch === "'") rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// Strict text escape: & is always escaped (used for plain text nodes;
// entity references are separate raw nodes, and backslash-escaped
// characters reach here as plain text, so `\&ouml;` becomes `&amp;ouml;`).
function escapeTextStrict(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let rep = null;
    if (ch === '&') rep = '&amp;';
    else if (ch === '<') rep = '&lt;';
    else if (ch === '>') rep = '&gt;';
    else if (ch === '"') rep = '&quot;';
    else if (ch === "'") rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// Percent-encode a link destination the way marked does (encodeURI:
// backslash, quotes, <>, ^, `, {}, |, non-ASCII, ...), then escape it
// for the attribute. encodeURI throws on lone surrogates: keep the
// raw string then.
function encodeHref(s) {
  // percent-encode, but leave valid %XX sequences alone (do not
  // double-encode an already-encoded destination) and leave a bare
  // '%' (not part of a %XX sequence) alone too
  const parts = s.split(/(%[0-9A-Fa-f]{2})/);
  let out = '';
  for (const p of parts) {
    if (/^%[0-9A-Fa-f]{2}$/.test(p)) { out += p; continue; }
    try { out += encodeURI(p).replace(/%25/g, '%'); } catch { out += p; }
  }
  return out;
}

// Escape an attribute value (href/src/title/alt/class): & (entity-aware),
// ", <, >.
function escapeAttr(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let rep = null;
    if (ch === '&') {
      if (!looksLikeEntity(s, i)) rep = '&amp;';
    } else if (ch === '"') rep = '&quot;';
    else if (ch === '<') rep = '&lt;';
    else if (ch === '>') rep = '&gt;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// Escape code content (&, <, > only — no entity-awareness: in code,
// &ouml; must become &amp;ouml;).
function escapeCode(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    let rep = null;
    if (ch === '&') rep = '&amp;';
    else if (ch === '<') rep = '&lt;';
    else if (ch === '>') rep = '&gt;';
    else if (ch === '"') rep = '&quot;';
    else if (ch === "'") rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// True when s[i] == '&' and the text from i looks like a character
// reference: &name; (name = letter followed by alphanumerics) or a
// numeric reference &#digits; / &#x hex; — valid or not, made-up names
// included; what matters is the shape, which is what marked preserves.
function looksLikeEntity(s, i) {
  let j = i + 1;
  if (j >= s.length) return false;
  const c = s[j];
  if (c === '#') {
    j++;
    let hex = false;
    if (j < s.length && (s[j] === 'x' || s[j] === 'X')) { hex = true; j++; }
    const st = j;
    if (hex) { while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) j++; }
    else { while (j < s.length && s[j] >= '0' && s[j] <= '9') j++; }
    if (j === st || j >= s.length || s[j] !== ';') return false;
    // only a valid code point counts: out-of-range or surrogate
    // references are not entities, so their & is escaped.
    const cp = parseInt(s.slice(st, j), hex ? 16 : 10);
    return isFinite(cp) && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF);
  }
  if (!isAlphaCh(c)) return false;
  j++;
  while (j < s.length && isAlnumCh(s[j])) j++;
  return j < s.length && s[j] === ';';
}

// Decode a numeric character reference starting at s[i] == '&'.
// Returns [decodedChar, lengthConsumed] or null when it is not a valid
// numeric reference (then the caller leaves "&" to be escaped).
function decodeNumericEntity(s, i) {
  let j = i + 2; // past '&#'
  let hex = false;
  if (j < s.length && (s[j] === 'x' || s[j] === 'X')) { hex = true; j++; }
  const st = j;
  if (hex) { while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) j++; }
  else { while (j < s.length && s[j] >= '0' && s[j] <= '9') j++; }
  if (j === st || j >= s.length || s[j] !== ';') return null;
  let cp = parseInt(s.slice(st, j), hex ? 16 : 10);
  if (!isFinite(cp)) return null;
  if (cp === 0) cp = 0xFFFD;
  if (cp > 0x10FFFF) return null;
  // Surrogates and noncharacters: marked renders them as the code point
  // itself via String.fromCodePoint except 0; keep fromCodePoint behaviour.
  let ch;
  try { ch = String.fromCodePoint(cp); } catch { return null; }
  return [ch, j - i + 1];
}

// ---------------------------------------------------------------- links

// Normalize a link label: collapse internal whitespace (incl. newlines)
// to single spaces, trim, case-fold. Used as the key for reference maps.
function normalizeLabel(s) {
  // Unicode case folding (CommonMark): ẞ/ß fold to "ss", ligatures
  // expand, long s folds to "s"; the rest folds via toLowerCase.
  const folded = s.replace(/ẞ/g, 'ss').replace(/ß/g, 'ss')
    .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/ﬅ/g, 'st')
    .replace(/ﬆ/g, 'st').replace(/ſ/g, 's');
  return folded.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse a link destination starting at pos in s (pos is the first char
// after '(' or after ':' in a definition). Skips leading whitespace and
// newlines when allowWs is set. Returns {dest, next} where next is the
// index just past the destination, or null.
function parseLinkDestination(s, pos, allowWs, allowEmpty) {
  let i = pos;
  if (allowWs) while (i < s.length && isLinkWs(s[i])) i++;
  if (i >= s.length) return null;
  if (s[i] === '<') {
    let j = i + 1;
    let dest = '';
    while (j < s.length) {
      const ch = s[j];
      if (ch === '\n') return null;
      if (ch === '<') return null;
      if (ch === '\\' && j + 1 < s.length && isAsciiPunctCh(s[j + 1])) { dest += s[j + 1]; j += 2; continue; }
      if (ch === '>') return { dest, next: j + 1 };
      dest += ch;
      j++;
    }
    return null;
  }
  // Bare destination: no spaces/control chars, balanced parens.
  let depth = 0;
  let j = i;
  let dest = '';
  while (j < s.length) {
    const ch = s[j];
    if (isLinkWs(ch)) break;
    if (ch === '\\' && j + 1 < s.length && isAsciiPunctCh(s[j + 1])) { dest += s[j + 1]; j += 2; continue; }
    if (ch === '(') { depth++; dest += ch; j++; continue; }
    if (ch === ')') {
      if (depth === 0) break;
      depth--; dest += ch; j++; continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) break;
    dest += ch;
    j++;
  }
  // an empty bare destination is valid for an inline link ([link]())
  // but not for a link reference definition
  if (j === i && !allowEmpty) return null;
  return { dest, next: j };
}

// Parse a link title starting at pos (after optional whitespace).
// Returns {title, next} or null. Titles may span lines.
function parseLinkTitle(s, pos) {
  let i = pos;
  while (i < s.length && isLinkWs(s[i])) i++;
  if (i >= s.length) return null;
  const open = s[i];
  let close;
  if (open === '"') close = '"';
  else if (open === "'") close = "'";
  else if (open === '(') close = ')';
  else return null;
  let j = i + 1;
  let title = '';
  while (j < s.length) {
    const ch = s[j];
    if (ch === '\\' && j + 1 < s.length && isAsciiPunctCh(s[j + 1])) { title += s[j + 1]; j += 2; continue; }
    if (ch === close) return { title, next: j + 1 };
    if (open === '(' && ch === '(') return null;
    title += ch;
    j++;
  }
  return null;
}

// Try to parse a link reference definition starting at the beginning
// of `lines[li]` (a paragraph line, possibly with leading spaces).
// The label, destination and title may each continue onto following
// lines (a title may span several lines). Returns
// {label, dest, title, linesUsed} or null.
function parseLinkRefDef(lines, li) {
  const first = lines[li];
  let i = 0;
  let indent = 0;
  while (i < first.length && first[i] === ' ') { indent++; i++; }
  if (indent > 3) return null;
  if (first[i] !== '[') return null;
  // Join the remaining lines: the label, destination and title are
  // parsed from this text, and linesUsed counts the newlines consumed.
  const text = first.slice(i) + (li + 1 < lines.length ? '\n' + lines.slice(li + 1).join('\n') : '');
  // label: [ ... ] up to the first unescaped ']'; an unescaped '['
  // inside makes the label invalid; backslashes are kept raw (the
  // label is matched on its raw text, escapes not resolved).
  let j = 1;
  let label = '';
  let ok = false;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\' && j + 1 < text.length) { label += text[j] + text[j + 1]; j += 2; continue; }
    if (ch === '[') return null;
    if (ch === ']') { ok = true; break; }
    label += ch;
    j++;
  }
  if (!ok || j >= text.length) return null;
  const normLabel = normalizeLabel(label);
  if (normLabel.length === 0 || label.length > 999) return null;
  if (/\n[ \t]*\n/.test(label)) return null;
  j++; // past ']'
  if (text[j] !== ':') return null;
  j++;
  const d = parseLinkDestination(text, j, true);
  if (!d) return null;
  let end = d.next;
  let title = null;
  // optional title (may be on a following line, may span lines): it
  // must be separated from the destination by whitespace, and nothing
  // but whitespace may follow it on its line; otherwise the
  // definition is destination-only.
  let q = end;
  let hadWs = false;
  while (q < text.length && isLinkWs(text[q])) { hadWs = true; q++; }
  if (hadWs && q < text.length && (text[q] === '"' || text[q] === "'" || text[q] === '(')) {
    const t = parseLinkTitle(text, end);
    if (t) {
      let r2 = t.next;
      while (r2 < text.length && (text[r2] === ' ' || text[r2] === '\t')) r2++;
      if (r2 >= text.length || text[r2] === '\n') { title = t.title; end = t.next; }
    }
  }
  // after the destination/title, only spaces/tabs to the end of the line
  let r = end;
  while (r < text.length && (text[r] === ' ' || text[r] === '\t')) r++;
  if (r < text.length && text[r] !== '\n') return null;
  let linesUsed = 1;
  for (let k = 0; k < end; k++) if (text[k] === '\n') linesUsed++;
  return { label: normLabel, dest: d.dest, title, linesUsed };
}

// ---------------------------------------------------------------- inline
// Node kinds: 0 text, 1 em, 2 strong, 3 del, 4 code, 5 link, 6 image,
// 7 raw html, 8 hard break.

const DISALLOWED_TAGS = new Set([
  'title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes',
  'script', 'plaintext',
]);

const EMAIL_LOCAL = "!#$%&'*+/=?^_`{|}~-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Try to match an HTML tag starting at s[i] == '<'. Returns the tag
// string (including < >) or null. Kinds: open, close, comment, pi,
// declaration, cdata.
function matchHtmlTag(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c1 = s[i + 1];
  if (c1 === '!') {
    if (s.startsWith('<!--', i)) {
      // abruptly closed empty comments are valid
      if (s.startsWith('<!-->', i)) return '<!-->';
      if (s.startsWith('<!--->', i)) return '<!--->';
      // comment: content must not start with > or ->, must not end
      // with - (a '--' inside does not disqualify it).
      let j = i + 4;
      if (j < n && s[j] === '>') return null;
      if (s.startsWith('->', j)) return null;
      const end = s.indexOf('-->', j);
      if (end < 0) return null;
      const inner = s.slice(j, end);
      if (inner.endsWith('-')) return null;
      return s.slice(i, end + 3);
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) return null;
      return s.slice(i, end + 3);
    }
    // declaration <!A ... >
    if (i + 2 < n && s[i + 2] >= 'A' && s[i + 2] <= 'Z') {
      let j = i + 3;
      while (j < n && s[j] !== '>') j++;
      if (j >= n) return null;
      return s.slice(i, j + 1);
    }
    return null;
  }
  if (c1 === '?') {
    const end = s.indexOf('?>', i + 2);
    if (end < 0) return null;
    return s.slice(i, end + 2);
  }
  if (c1 === '/') {
    let j = i + 2;
    if (j >= n || !isAlphaCh(s[j])) return null;
    while (j < n && (isAlnumCh(s[j]) || s[j] === '-')) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j >= n || s[j] !== '>') return null;
    return s.slice(i, j + 1);
  }
  if (!isAlphaCh(c1)) return null;
  let j = i + 1;
  while (j < n && (isAlnumCh(s[j]) || s[j] === '-')) j++;
  // attributes
  while (true) {
    // whitespace
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
    if (k >= n) return null;
    if (s[k] === '>') return s.slice(i, k + 1);
    if (s[k] === '/') {
      if (k + 1 < n && s[k + 1] === '>') return s.slice(i, k + 2);
      return null;
    }
    if (k === j) return null; // no whitespace before attribute
    j = k;
    // attribute name
    if (!(isAlphaCh(s[j]) || s[j] === '_' || s[j] === ':')) return null;
    j++;
    while (j < n && (isAlnumCh(s[j]) || s[j] === '_' || s[j] === '.' || s[j] === ':' || s[j] === '-')) j++;
    const nameEnd = j; // end of the attribute name
    // optional whitespace
    k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
    if (k < n && s[k] === '=') {
      j = k + 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      if (j >= n) return null;
      const q = s[j];
      if (q === '"' || q === "'") {
        j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        const st = j;
        while (j < n) {
          const ch = s[j];
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '"' || ch === "'" || ch === '=' || ch === '<' || ch === '>' || ch === '`') break;
          j++;
        }
        if (j === st) return null;
      }
    } else {
      // valueless attribute: leave j at the end of the name so the
      // loop's whitespace skip can consume the following whitespace
      j = nameEnd;
    }
  }
}

// Tag name of an html tag string (lowercased), or ''.
function tagNameOf(tag) {
  let i = 1;
  if (tag[i] === '/') i++;
  let j = i;
  while (j < tag.length && (isAlnumCh(tag[j]) || tag[j] === '-')) j++;
  return tag.slice(i, j).toLowerCase();
}

// Try an autolink <scheme:...> or <email> starting at s[i] == '<'.
// Returns {href, text, next} or null.
function matchAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  // scheme
  if (j < n && isAlphaCh(s[j])) {
    let k = j;
    while (k < n && (isAlnumCh(s[k]) || s[k] === '+' || s[k] === '.' || s[k] === '-')) k++;
    if (k - j >= 2 && k - j <= 32 && k < n && s[k] === ':') {
      // rest until '>' with no space/control/< 
      let m = k + 1;
      while (m < n && s[m] !== '>') {
        const c = s[m].charCodeAt(0);
        if (c <= 32 || s[m] === '<') return null;
        m++;
      }
      if (m < n && m > k + 1) {
        const text = s.slice(i + 1, m);
        return { href: text, text, next: m + 1 };
      }
      return null;
    }
  }
  // email: local@domain(.domain)+
  let k = j;
  while (k < n && EMAIL_LOCAL.indexOf(s[k]) >= 0) k++;
  if (k > j && k < n && s[k] === '@') {
    const localEnd = k;
    let m = k + 1;
    // domain: labels separated by dots, at least one dot
    let dots = 0;
    let ok = true;
    while (m < n && s[m] !== '>') {
      const c = s[m];
      if (!(isAlnumCh(c) || c === '-' || c === '.')) { ok = false; break; }
      if (c === '.') dots++;
      m++;
    }
    if (ok && m < n && dots >= 1 && m > localEnd + 1) {
      const text = s.slice(i + 1, m);
      // domain must not start/end with . or - and labels must be valid
      const dom = text.slice(text.indexOf('@') + 1);
      if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(dom)) return null;
      return { href: 'mailto:' + text, text, next: m + 1 };
    }
  }
  return null;
}

// Validate a domain: labels of alnum/hyphen not starting/ending with
// hyphen, at least one dot.
function validDomain(dom) {
  if (dom.length === 0 || dom.indexOf('.') < 0) return false;
  const labels = dom.split('.');
  for (const lab of labels) {
    if (lab.length === 0) return false;
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(lab)) return false;
  }
  return true;
}

const TRAIL_PUNCT = new Set(['?', '!', '.', ',', ':', ';', '*', '_', '~', "'", '"']);

// Trim trailing punctuation / unbalanced parens / trailing entity from
// an extended-autolink candidate. Returns the trimmed length.
function trimAutolinkTail(s, start, end) {
  let e = end;
  while (e > start) {
    const ch = s[e - 1];
    if (ch === ')') {
      // count parens in [start, e): if more ')' than '(', drop this one
      let open = 0, close = 0;
      for (let k = start; k < e; k++) {
        if (s[k] === '(') open++;
        else if (s[k] === ')') close++;
      }
      if (close > open) { e--; continue; }
      break;
    }
    if (ch === ';') {
      // entity-like &...; at the end? drop back to the &
      let k = e - 2;
      while (k >= start && isAlnumCh(s[k])) k--;
      if (k >= start && s[k] === '&') { e = k; continue; }
      // plain trailing ';' is punctuation
      e--; continue;
    }
    if (TRAIL_PUNCT.has(ch)) { e--; continue; }
    break;
  }
  return e;
}

// Try an extended autolink (www., scheme://, email) starting at s[i].
// prevCh is the character before i (or ''). Returns {href, text, next}
// or null.
function matchExtendedAutolink(s, i, prevCh, hasUnderscoreOpener) {
  const n = s.length;
  // must start at a word boundary: previous char is start, whitespace,
  // or punctuation (not alnum, not one of the autolink's own chars).
  if (prevCh !== '' && !isWsCh(prevCh) && !isPunctCh(prevCh)) return null;
  // candidate: run of non-space, non-'<' chars; stop before a ']'
  // that opens a link destination (']('), so '[text https://x](y)'
  // resolves as the outer link, not as an autolink swallowing ']('
  let end = i;
  while (end < n) {
    const c = s[end];
    if (isWsCh(c) || c === '<') break;
    if (c === ']' && s[end + 1] === '(') break;
    end++;
  }
  if (end === i) return null;
  const cand = s.slice(i, end);
  // www.
  if (cand.startsWith('www.')) {
    const e = trimAutolinkTail(s, i, end);
    if (e - i <= 4) return null;
    const body = s.slice(i, e);
    // domain part: up to first '/' '?' '#'
    let di = body.search(/[\\/?#]/);
    if (di < 0) di = body.length;
    const dom = body.slice(0, di);
    if (!validDomain(dom)) return null;
    return { href: 'http://' + body, text: body, next: i + body.length };
  }
  // scheme://
  const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\//.exec(cand);
  if (sm) {
    const e = trimAutolinkTail(s, i, end);
    const body = s.slice(i, e);
    let di = body.indexOf('/', sm[0].length);
    let qi = body.search(/[\?#]/);
    let domEnd = body.length;
    if (di >= 0) domEnd = Math.min(domEnd, di);
    if (qi >= 0) domEnd = Math.min(domEnd, qi);
    const dom = body.slice(sm[0].length, domEnd);
    if (!validDomain(dom)) return null;
    return { href: body, text: body, next: i + body.length };
  }
  // scheme:email (mailto:, xmpp:, ...) with an optional single path
  // segment after the email, e.g. xmpp:foo@bar.baz/txt
  const sch = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(cand);
  if (sch && !cand.slice(sch[0].length).startsWith('//')) {
    const after = sch[0].length;
    const em2 = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.exec(cand.slice(after));
    if (em2) {
      let e = after + em2[0].length;
      // the email must not be followed by a word char (e.g. '_'),
      // except a '__' closing delimiter, or a single '_' that closes
      // an open '_' emphasis (a '_' closer is not part of the email)
      if (!(e < cand.length && /[A-Za-z0-9_]/.test(cand[e]) && !(cand[e] === '_' && cand[e + 1] === '_') && !(cand[e] === '_' && hasUnderscoreOpener))) {
        const body0 = cand.slice(0, e);
        const at = body0.lastIndexOf('@');
        const dom = body0.slice(at + 1);
        const local = body0.slice(after, at);
        if (validDomain(dom) && !local.startsWith('.') && !local.endsWith('.') && local.indexOf('..') < 0) {
          // optional single path segment: '/' + non-'/' non-space chars
          if (e < cand.length && cand[e] === '/') {
            let pe = e + 1;
            while (pe < cand.length && !isWsCh(cand[pe]) && cand[pe] !== '<' && cand[pe] !== '/') pe++;
            if (pe > e + 1) e = pe;
          }
          const te = trimAutolinkTail(s, i, i + e);
          if (te - i > sch[0].length) {
            const body = s.slice(i, te);
            return { href: body, text: body, next: i + body.length };
          }
        }
      }
    }
  }
  // email: local@domain with a dot
  const em = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.exec(cand);
  if (em) {
    // the email must not be followed by a word char (e.g. '_'):
    // 'a@b.c_' is not an autolink. A '__' (closing strong delimiter)
    // does not block it, nor does a single '_' that closes an open
    // '_' emphasis.
    if (em[0].length < cand.length && /[A-Za-z0-9_]/.test(cand[em[0].length])) {
      const nx = cand[em[0].length];
      if (!(nx === '_' && cand[em[0].length + 1] === '_') && !(nx === '_' && hasUnderscoreOpener)) return null;
    }
    let e = i + em[0].length;
    // trim trailing punctuation from the match
    e = trimAutolinkTail(s, i, e);
    if (e <= i) return null;
    const body = s.slice(i, e);
    const at = body.lastIndexOf('@');
    const dom = body.slice(at + 1);
    if (!validDomain(dom)) return null;
    // local part must not start/end with '.' and must not contain '..'
    const local = body.slice(0, at);
    if (local.startsWith('.') || local.endsWith('.') || local.indexOf('..') >= 0) return null;
    return { href: 'mailto:' + body, text: body, next: i + body.length };
  }
  return null;
}

// ---------------------------------------------------------------- inline scan

function parseInline(text, refs) {
  const nodes = [];   // inline node list (flat; link nodes hold children)
  const delims = [];  // delimiter entries {ch, node, len, canOpen, canClose, active}
  const brackets = []; // bracket entries {node, image, active}
  const n = text.length;
  let i = 0;
  let buf = ''; // pending plain text

  function flushBuf() {
    if (buf !== '') { nodes.push({ k: 0, s: buf }); buf = ''; }
  }
  function pushText(s) { buf += s; }
  function pushNode(nd) { flushBuf(); nodes.push(nd); }

  while (i < n) {
    const ch = text[i];
    // --- hard / soft break via backslash-newline or two spaces + newline
    if (ch === '\\') {
      if (i + 1 < n && text[i + 1] === '\n') {
        flushBuf(); nodes.push({ k: 8 });
        i += 2;
        // leading spaces/tabs after a hard break are skipped
        while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
        continue;
      }
      if (i + 1 < n && isAsciiPunctCh(text[i + 1])) { pushText(text[i + 1]); i += 2; continue; }
      pushText('\\'); i++; continue;
    }
    if (ch === '\n') {
      // two or more trailing spaces before the newline => hard break
      let sp = 0;
      let k = i - 1;
      while (k >= 0 && text[k] === ' ') { sp++; k--; }
      if (sp >= 2) {
        // strip the trailing spaces from buf
        buf = buf.slice(0, buf.length - sp);
        flushBuf(); nodes.push({ k: 8 });
        i++;
        // leading spaces/tabs after a hard break are skipped
        while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
        continue;
      }
      pushText('\n'); i++; continue;
    }
    if (ch === '`') {
      // backtick run
      let j = i;
      while (j < n && text[j] === '`') j++;
      const len = j - i;
      // find a later run of exactly len backticks
      let k = j;
      let close = -1;
      while (k < n) {
        if (text[k] === '`') {
          let m = k;
          while (m < n && text[m] === '`') m++;
          if (m - k === len) { close = k; break; }
          k = m;
        } else k++;
      }
      if (close >= 0) {
        let content = text.slice(j, close);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && isWhitespaceStr(content) === false) {
          content = content.slice(1, -1);
        }
        flushBuf(); nodes.push({ k: 4, s: content });
        i = close + len;
        continue;
      }
      pushText(text.slice(i, j)); i = j; continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let j = i;
      while (j < n && text[j] === ch) j++;
      const len = j - i;
      // strikethrough uses one or two tildes; a run of three or
      // more tildes is literal text, not a delimiter
      if (ch === '~' && len > 2) { pushText(text.slice(i, j)); i = j; continue; }
      const prev = i > 0 ? text[i - 1] : '';
      const next = j < n ? text[j] : '';
      // The start and end of the text count as Unicode whitespace
      // for flanking purposes.
      const nextIsWs = next === '' || isWsCh(next);
      const nextIsPunct = next !== '' && isPunctCh(next);
      const prevIsWs = prev === '' || isWsCh(prev);
      const prevIsPunct = prev !== '' && isPunctCh(prev);
      const leftFlank = !nextIsWs && (!nextIsPunct || prevIsWs || prevIsPunct);
      const rightFlank = !prevIsWs && (!prevIsPunct || nextIsWs || nextIsPunct);
      let canOpen, canClose;
      if (ch === '_') {
        canOpen = leftFlank && (!rightFlank || isPunctCh(prev));
        canClose = rightFlank && (!leftFlank || isPunctCh(next));
      } else {
        canOpen = leftFlank;
        canClose = rightFlank;
      }
      flushBuf();
      const nd = { k: 0, s: text.slice(i, j) };
      nodes.push(nd);
      delims.push({ ch, node: nd, len, origLen: len, canOpen, canClose, active: true });
      i = j;
      continue;
    }
    if (ch === '[' || (ch === '!' && i + 1 < n && text[i + 1] === '[')) {
      const image = ch === '!';
      flushBuf();
      const nd = { k: 0, s: image ? '![' : '[' };
      nodes.push(nd);
      brackets.push({ node: nd, image, active: true, pos: image ? i + 1 : i });
      i += image ? 2 : 1;
      continue;
    }
    if (ch === ']') {
      flushBuf();
      nodes.push({ k: 0, s: ']' });
      // try to resolve a link with the nearest active bracket
      const res = tryResolveLink(text, i, nodes, brackets, refs);
      if (res) { i = res; continue; }
      // no link formed: this ']' closes the nearest active bracket,
      // so that bracket is dead (a later ']' must use an outer one)
      for (let b = brackets.length - 1; b >= 0; b--) {
        if (brackets[b].active) { brackets[b].active = false; break; }
      }
      i++;
      continue;
    }
    if (ch === '<') {
      const al = matchAutolink(text, i);
      if (al) {
        pushNode({ k: 5, href: al.href, title: null, c: [{ k: 10, s: al.text }] });
        i = al.next;
        continue;
      }
      const tag = matchHtmlTag(text, i);
      if (tag !== null) {
        pushNode({ k: 7, s: tag });
        i += tag.length;
        continue;
      }
      pushText('<'); i++; continue;
    }
    if (ch === '&') {
      const dec = decodeNumericEntity(text, i);
      if (dec) { pushText(dec[0]); i += dec[1]; continue; }
      // A named reference (any shape &name;) passes through verbatim:
      // it becomes a raw node, rendered as-is. Anything else is a
      // plain '&', escaped to &amp; when the text node renders.
      if (looksLikeEntity(text, i)) {
        let j = i + 1;
        while (j < n && text[j] !== ';') j++;
        flushBuf();
        nodes.push({ k: 9, s: text.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      pushText('&'); i++; continue;
    }
    // extended autolink check at word starts
    if (isAlnumCh(ch)) {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev === '' || isWsCh(prev) || isPunctCh(prev)) {
        let hasU = false;
        for (let d = 0; d < delims.length; d++) {
          if (delims[d].ch === '_' && delims[d].active && delims[d].canOpen) { hasU = true; break; }
        }
        const ea = matchExtendedAutolink(text, i, prev, hasU);
        if (ea) {
          pushNode({ k: 5, href: ea.href, title: null, c: [{ k: 10, s: ea.text }], ext: true });
          i = ea.next;
          continue;
        }
      }
      pushText(ch); i++; continue;
    }
    pushText(ch); i++;
  }
  flushBuf();

  processEmphasis(nodes, delims);
  return renderInline(nodes);
}

// Attempt to resolve a link when ']' was just scanned at position i
// (the ']' was already pushed as a text node). Returns the new scan
// position (just past the link markup) on success, or 0.
function tryResolveLink(text, closePos, nodes, brackets, refs) {
  // nearest active bracket
  let bi = -1;
  for (let b = brackets.length - 1; b >= 0; b--) {
    if (brackets[b].active) { bi = b; break; }
  }
  if (bi < 0) return 0;
  const br = brackets[bi];
  // The ']' text node is the last node; bracket node index:
  const closeIdx = nodes.length - 1;
  const openIdx = nodes.indexOf(br.node);
  if (openIdx < 0 || openIdx >= closeIdx) return 0;

  let dest = null, title = null, next = -1;
  // inline link: '(' must follow ']' immediately (no whitespace)
  let p = closePos + 1;
  if (p < text.length && text[p] === '(') {
    const d = parseLinkDestination(text, p + 1, true, true);
    if (d) {
      let q = d.next;
      while (q < text.length && isLinkWs(text[q])) q++;
      if (q < text.length && text[q] === ')') {
        dest = d.dest; next = q + 1;
      } else if (q > d.next) {
        // a title must be separated from the destination by whitespace
        const t = parseLinkTitle(text, q);
        if (t) {
          let r = t.next;
          while (r < text.length && isLinkWs(text[r])) r++;
          if (r < text.length && text[r] === ')') { dest = d.dest; title = t.title; next = r + 1; }
        }
      }
    }
  }
  if (dest === null) {
    // reference link: [label], [], or shortcut
    let label = null;
    let after = closePos + 1;
    if (after < text.length && text[after] === '[') {
      // parse label [...] (may contain balanced brackets, escapes)
      let j = after + 1;
      // full reference: [text][label]; the label ends at the first
      // unescaped ']', backslashes are kept raw for matching, and an
      // unescaped '[' inside makes the label invalid
      let lab = '';
      let ok = false;
      let bad = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) { lab += text[j] + text[j + 1]; j += 2; continue; }
        if (c === '[') { bad = true; break; }
        if (c === ']') { ok = true; break; }
        lab += c;
        j++;
      }
      if (ok && !bad) { label = lab; next = j + 1; }
      else if (j === after + 1) { label = ''; next = j + 1; } // collapsed []
    }
    if (label === null) {
      // shortcut: label is the bracket's raw source text (backslashes
      // are kept, so 'foo\!' does not match a 'foo!' definition)
      label = text.slice(br.pos + 1, closePos);
      next = closePos + 1;
    }
    if (label !== null) {
      const norm = normalizeLabel(label);
      const ref = norm === '' ? null : refs.get(norm);
      if (ref) { dest = ref.dest; title = ref.title; }
      else {
        // collapsed [] with empty label falls back to shortcut label
        if (label === '') {
          const short = normalizeLabel(text.slice(br.pos + 1, closePos));
          const ref2 = short === '' ? null : refs.get(short);
          if (ref2) { dest = ref2.dest; title = ref2.title; }
        }
      }
    }
  }
  if (dest === null) return 0;
  // Build the link/image node from nodes between open and close.
  const children = nodes.slice(openIdx + 1, closeIdx);
  // a bare-URL / www. / email autolink inside a link's text renders
  // as plain text (an angle-bracket autolink keeps its link). Strip
  // extended autolinks from a link's children when the link forms;
  // a bracket that never resolves keeps them as links.
  if (!br.image) {
    const stripExt = (list) => {
      for (let x = 0; x < list.length; x++) {
        const nd = list[x];
        if (nd.k === 5 && nd.ext) { list[x] = { k: 10, s: nd.c[0].s }; continue; }
        if ((nd.k === 1 || nd.k === 2 || nd.k === 3) && nd.c) stripExt(nd.c);
      }
    };
    stripExt(children);
  }
  // a link cannot contain another link: if this is a link bracket
  // (not an image) and its content already holds a link node, it
  // cannot resolve (the ']' stays literal). Images may contain a
  // link in their alt text, so this only applies to link brackets.
  // Descend through emphasis/del wrappers, but not into images.
  if (!br.image) {
    // an autolink (or extended autolink) inside the text does not
    // block the link; only a bracket-formed link does.
    const isAuto = (nd) => nd.k === 5 && nd.c && nd.c.length === 1 && nd.c[0].k === 10;
    const hasLink = (list) => {
      for (const nd of list) {
        if (nd.k === 5 && !isAuto(nd)) return true;
        if ((nd.k === 1 || nd.k === 2 || nd.k === 3) && nd.c && hasLink(nd.c)) return true;
      }
      return false;
    };
    if (hasLink(children)) return 0;
  }
  // inner brackets become inactive (their text stays literal)
  for (let b = 0; b < brackets.length; b++) {
    if (brackets[b].active && nodes.indexOf(brackets[b].node) > openIdx && nodes.indexOf(brackets[b].node) < closeIdx) brackets[b].active = false;
  }
  br.active = false;
  const linkNode = br.image
    ? { k: 6, src: dest, title, c: children }
    : { k: 5, href: dest, title, c: children };
  nodes.splice(openIdx, closeIdx - openIdx + 1, linkNode);
  return next;
}

// Plain-text content of inline nodes (used for link labels and alt
// text): text and code as-is, emphasis/link children recursively,
// raw html contributes its literal text.
function inlineTextContent(list) {
  let out = '';
  for (const nd of list) {
    if (nd.k === 0 || nd.k === 4 || nd.k === 9 || nd.k === 10) out += nd.s;
    else if (nd.k === 1 || nd.k === 2 || nd.k === 3 || nd.k === 5) out += inlineTextContent(nd.c);
    else if (nd.k === 6) out += inlineTextContent(nd.c);
    else if (nd.k === 7) out += nd.s;
    else if (nd.k === 8) out += '\n';
  }
  return out;
}

// Resolve emphasis / strong / strikethrough from the delimiter stack.
// Works on one node list; link/image children are handled by recursion
// (delimiters are filtered to those whose node is in this list).
function processEmphasis(list, delims) {
  const inList = new Set(list);
  const mine = delims.filter(d => d.active && inList.has(d.node));
  // recurse into link/image children for delimiters that live there,
  // at any depth (a link may be nested inside an emphasis wrapper)
  const walkLinks = (nodes) => {
    for (const nd of nodes) {
      if ((nd.k === 5 || nd.k === 6) && nd.c) processEmphasis(nd.c, delims);
      if ((nd.k === 1 || nd.k === 2 || nd.k === 3) && nd.c) walkLinks(nd.c);
    }
  };
  if (mine.length === 0) {
    walkLinks(list);
    return;
  }
  // delimiter entries in document order, each pointing at its text node
  for (let ci = 0; ci < mine.length; ci++) {
    const closer = mine[ci];
    if (!closer.active || !closer.canClose) continue;
    // find an opener: scan backwards for same char, canOpen, not odd-match
    let opener = null;
    for (let oi = ci - 1; oi >= 0; oi--) {
      const cand = mine[oi];
      if (!cand.active || cand.ch !== closer.ch || !cand.canOpen) continue;
      if (cand.dead) continue;
      // an opener already wrapped inside another emphasis is gone
      if (list.indexOf(cand.node) < 0) continue;
      // the odd-match rule applies only when one of the two
      // delimiters can both open and close emphasis
      const odd = (cand.len + closer.len) % 3 === 0 &&
        (cand.len % 3 !== 0 || closer.len % 3 !== 0) &&
        (cand.canClose || closer.canOpen);
      if (odd) continue;
      // a single closer must not steal a delimiter from a two-long
      // opener when a later closer of length >= 2 could pair with
      // that opener to form a strong (e.g. **a *b*c** keeps the
      // strong and leaves the single * literal). An opener of
      // length >= 3 can spare one and still form a strong, so it
      // is not skipped (***foo* bar** -> <strong><em>foo</em> bar</strong>).
      if (closer.len === 1 && cand.len === 2) {
        let laterStrong = false;
        for (let li = ci + 1; li < mine.length; li++) {
          const lc = mine[li];
          if (lc.active && lc.ch === closer.ch && lc.canClose && lc.len >= 2) { laterStrong = true; break; }
        }
        if (laterStrong) continue;
      }
      // a single closer must not pair with a single opener when a
      // consumed '**' pair sits between them whose opener is a pure
      // opener (preceded by space) and whose closer could also open
      // (followed by text, e.g. *a **b**c*): marked leaves the outer
      // '*' literal and keeps only the inner strong. If the '**'
      // opener is attached to text (canClose, *foo**bar**baz*) or
      // the '**' closer is followed by a space (*foo **bar** baz*),
      // the outer em does form. The blocked opener is dead: it must
      // not pair with a later '**' closer either, or the outer
      // strong would be stolen into nested ems.
      if (closer.len === 1 && cand.len === 1) {
        const oiD = delims.indexOf(cand);
        const ciD = delims.indexOf(closer);
        let pureOpener = false, dualCloser = false;
        if (oiD >= 0 && ciD > oiD) {
          for (let di = oiD + 1; di < ciD; di++) {
            const dd = delims[di];
            if (dd.ch === closer.ch && !dd.active && dd.len === 0 && dd.origLen === 2) {
              if (dd.canOpen && !dd.canClose) pureOpener = true;
              if (dd.canOpen && dd.canClose) dualCloser = true;
            }
          }
        }
        if (pureOpener && dualCloser) { cand.dead = true; continue; }
      }
      opener = cand;
      break;
    }
    if (!opener) continue;
    const use = (opener.len >= 2 && closer.len >= 2) ? 2 : 1;
    // a tilde always makes a del (kind 3), whether one or two are
    // used; * / _ make em (1) or strong (2)
    const kind = closer.ch === '~' ? 3 : (use === 2 ? 2 : 1);
    const oi = list.indexOf(opener.node);
    const ci2 = list.indexOf(closer.node);
    if (oi < 0 || ci2 < 0 || ci2 <= oi) continue;
    const middle = list.slice(oi + 1, ci2);
    const wrapper = { k: kind, c: middle };
    // trim the used delimiters off the opener/closer text nodes
    opener.node.s = opener.node.s.slice(0, opener.node.s.length - use);
    opener.len -= use;
    closer.node.s = closer.node.s.slice(use);
    closer.len -= use;
    if (opener.len === 0) opener.active = false;
    if (closer.len === 0) closer.active = false;
    // splice: replace [oi .. ci2] with opener-remnant?, wrapper, closer-remnant?
    // The opener/closer text nodes stay in place (possibly emptied).
    const repl = [];
    if (opener.node.s !== '') repl.push(opener.node);
    repl.push(wrapper);
    if (closer.node.s !== '') repl.push(closer.node);
    list.splice(oi, ci2 - oi + 1, ...repl);
    // The closer may still have delimiters left: it can close again for
    // an earlier opener (e.g. ***a***). Revisit this same closer.
    if (closer.len > 0) ci--;
  }
  walkLinks(list);
}

function renderInline(list) {
  let out = '';
  for (const nd of list) {
    switch (nd.k) {
      case 0: out += escapeTextStrict(nd.s); break;
      case 9: out += nd.s; break; // raw entity reference, verbatim
      case 10: out += escapeText(nd.s); break; // autolink text, entity-aware
      case 1: out += '<em>' + renderInline(nd.c) + '</em>'; break;
      case 2: out += '<strong>' + renderInline(nd.c) + '</strong>'; break;
      case 3: out += '<del>' + renderInline(nd.c) + '</del>'; break;
      case 4: out += '<code>' + escapeCode(nd.s) + '</code>'; break;
      case 5: {
        out += '<a href="' + escapeAttr(encodeHref(nd.href)) + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escapeAttr(nd.title) + '"';
        out += '>' + renderInline(nd.c) + '</a>';
        break;
      }
      case 6: {
        const alt = escapeAttr(inlineTextContent(nd.c));
        out += '<img src="' + escapeAttr(encodeHref(nd.src)) + '" alt="' + alt + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escapeAttr(nd.title) + '"';
        out += '>';
        break;
      }
      case 7: out += nd.s; break;
      case 8: out += '<br>'; break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- blocks
// A line is {s, pos, col, eol}: s the (mutable) text, pos the char index
// the parser has reached, col its visual column (tabs advance to the
// next multiple of 4), eol whether the line was newline-terminated.

// Advance the cursor to targetCol using only spaces/tabs. A tab that
// straddles the target is rewritten as spaces and partly consumed.
// Returns true when the target column is reached (or already passed).
function advanceTo(line, targetCol) {
  while (line.col < targetCol && line.pos < line.s.length) {
    const ch = line.s[line.pos];
    if (ch === ' ') { line.pos++; line.col++; continue; }
    if (ch === '\t') {
      const nextCol = line.col + (4 - (line.col % 4));
      if (nextCol <= targetCol) { line.pos++; line.col = nextCol; continue; }
      // partial tab: rewrite as spaces, consume up to the target
      const spaces = nextCol - line.col;
      line.s = line.s.slice(0, line.pos) + ' '.repeat(spaces) + line.s.slice(line.pos + 1);
      const take = targetCol - line.col;
      line.pos += take;
      line.col = targetCol;
      return true;
    }
    return false;
  }
  return line.col >= targetCol;
}

// Expand leading tabs at the cursor into spaces (to the next tab
// stop). Only when the line already had indent consumed (line.pos >
// 0): a tab at the very start of a line is literal code content.
// line.pos stays at the start of the expanded spaces so they are
// part of the content; line.col advances past them.
function expandLeadingTabs(line, colAdjust) {
  if (line.pos === 0) return;
  let pos = line.pos;
  let col = line.col;
  let out = '';
  while (pos < line.s.length && line.s[pos] === '\t') {
    const spaces = 4 - (col % 4);
    out += ' '.repeat(spaces);
    col += spaces;
    pos++;
  }
  if (out) {
    line.s = line.s.slice(0, line.pos) + out + line.s.slice(pos);
    line.col = col;
  }
}

// Columns of indentation (spaces/tabs) from the cursor, without moving it.
function indentAt(line) {
  let col = line.col;
  let p = line.pos;
  while (p < line.s.length) {
    const ch = line.s[p];
    if (ch === ' ') { col++; p++; }
    else if (ch === '\t') col += 4 - (col % 4), p++;
    else break;
  }
  return col - line.col;
}

function isBlankLine(line) {
  for (let p = line.pos; p < line.s.length; p++) {
    const ch = line.s[p];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section',
  'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);

function newBlock(t, parent) {
  const b = {
    t, parent, children: [], open: true, lastLineBlank: false,
    hadBlankBetween: false, lines: [],
  };
  if (parent) parent.children.push(b);
  return b;
}

// --- block-start matchers (line cursor is positioned after container
// markers; they read but do not move the cursor unless noted) ---

// Thematic break: 3+ of -, _, * with only spaces/tabs between, indent<=3.
function matchThematicBreak(line) {
  if (indentAt(line) > 3) return false;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  if (p >= line.s.length) return false;
  const c = line.s[p];
  if (c !== '-' && c !== '_' && c !== '*') return false;
  let n = 0;
  while (p < line.s.length) {
    const ch = line.s[p];
    if (ch === c) n++;
    else if (ch !== ' ' && ch !== '\t') return false;
    p++;
  }
  return n >= 3;
}

// ATX heading: #*1-6 followed by space/tab/EOL. Returns level or 0.
function matchAtx(line) {
  if (indentAt(line) > 3) return 0;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  let n = 0;
  while (p + n < line.s.length && line.s[p + n] === '#') n++;
  if (n === 0 || n > 6) return 0;
  const after = p + n;
  if (after >= line.s.length) return n;
  const c = line.s[after];
  if (c === ' ' || c === '\t') return n;
  return 0;
}

// Fenced code: ``` or ~~~ run, indent<=3. Returns {char, len} or null.
// For backtick fences the info string must not contain a backtick.
function matchFence(line) {
  if (indentAt(line) > 3) return null;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  const c = line.s[p];
  if (c !== '`' && c !== '~') return null;
  let n = 0;
  while (p + n < line.s.length && line.s[p + n] === c) n++;
  if (n < 3) return null;
  if (c === '`' && line.s.slice(p + n).indexOf('`') >= 0) return null;
  // indent columns before the fence, from the cursor
  let indentCols = 0;
  let col = line.col;
  for (let q = line.pos; q < p; q++) {
    if (line.s[q] === ' ') { indentCols++; col++; }
    else if (line.s[q] === '\t') { const nc = col + (4 - (col % 4)); indentCols += nc - col; col = nc; }
  }
  return { char: c, len: n, indent: indentCols, startCol: col };
}

// Setext underline: === or --- (a single contiguous run, then only
// spaces), indent<=3. Returns 1 for '=', 2 for '-', else 0.
function matchSetext(line) {
  if (indentAt(line) > 3) return 0;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  if (p >= line.s.length) return 0;
  const c = line.s[p];
  if (c !== '=' && c !== '-') return 0;
  let n = 0;
  while (p + n < line.s.length && line.s[p + n] === c) n++;
  let q = p + n;
  while (q < line.s.length) {
    if (line.s[q] !== ' ' && line.s[q] !== '\t') return 0;
    q++;
  }
  return n >= 1 ? (c === '=' ? 1 : 2) : 0;
}

// HTML block start. Returns type 1..7 or 0. `inParagraph` forbids type 7.
function matchHtmlBlock(line, inParagraph) {
  if (indentAt(line) > 3) return 0;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  const rest = line.s.slice(p);
  if (rest[0] !== '<') return 0;
  const low = rest.toLowerCase();
  // type 1: script, pre, style, textarea
  for (const tag of ['script', 'pre', 'style', 'textarea']) {
    if (low.startsWith('<' + tag)) {
      const a = rest[1 + tag.length];
      if (a === undefined || a === ' ' || a === '\t' || a === '\n' || a === '>' || a === '/') return 1;
    }
  }
  if (rest.startsWith('<!--')) return 2;
  if (rest.startsWith('<?')) return 3;
  if (rest.length > 2 && rest[1] === '!' && rest[2] >= 'A' && rest[2] <= 'Z') return 4;
  if (rest.startsWith('<![CDATA[')) return 5;
  // type 6: block tag open/close followed by space/tab/EOL/> or />
  let m = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(rest);
  if (m && BLOCK_TAGS.has(m[1].toLowerCase())) {
    const a = rest[m[0].length];
    if (a === undefined || a === ' ' || a === '\t' || a === '\n' || a === '>' || (a === '/' && rest[m[0].length + 1] === '>')) return 6;
  }
  if (inParagraph) return 0;
  // type 7: a complete open tag (with attributes) or closing tag, alone
  // on the line.
  const tag = matchHtmlTag(line.s, p);
  if (tag !== null) {
    let q = p + tag.length;
    while (q < line.s.length && (line.s[q] === ' ' || line.s[q] === '\t')) q++;
    if (q >= line.s.length) return 7;
  }
  return 0;
}

// List marker at the cursor (indent<=3). Returns
// {kind:'bullet'|'ordered', char, num, delim, markerLen} or null.
function matchListMarker(line) {
  if (indentAt(line) > 3) return null;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  const c = line.s[p];
  if (c === '-' || c === '+' || c === '*') {
    const after = p + 1;
    if (after >= line.s.length) return { kind: 'bullet', char: c, markerLen: 1, markerPos: p };
    const a = line.s[after];
    if (a === ' ' || a === '\t') return { kind: 'bullet', char: c, markerLen: 1, markerPos: p };
    return null;
  }
  if (c >= '0' && c <= '9') {
    let q = p;
    while (q < line.s.length && line.s[q] >= '0' && line.s[q] <= '9') q++;
    const numStr = line.s.slice(p, q);
    if (numStr.length > 9) return null;
    const num = parseInt(numStr, 10);
    if (num > 999999999) return null;
    if (q < line.s.length && (line.s[q] === '.' || line.s[q] === ')')) {
      const after = q + 1;
      if (after >= line.s.length) return { kind: 'ordered', num, delim: line.s[q], markerLen: q + 1 - p, markerPos: p };
      const a = line.s[after];
      if (a === ' ' || a === '\t') return { kind: 'ordered', num, delim: line.s[q], markerLen: q + 1 - p, markerPos: p };
    }
    return null;
  }
  return null;
}

// Table delimiter row: cells of - / : - patterns separated by |.
// Returns alignments array (null/'left'/'center'/'right') or null.
function matchTableDelimiter(line) {
  if (indentAt(line) > 3) return null;
  let p = line.pos;
  while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
  const rest = line.s.slice(p);
  if (rest.indexOf('-') < 0) return null;
  const cells = splitTableRow(rest);
  if (cells === null || cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const t = cell.trim();
    let m = /^:?-+:?$/.exec(t);
    if (!m) return null;
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return aligns;
}

// Split a table row line on unescaped |, honouring backslash escapes
// and code spans. Leading/trailing | produce empty edge cells, dropped.
// Resolve an escaped pipe \| to a plain | (the table-level escape);
// other backslash pairs are kept verbatim.
function resolveEscapedPipes(str) {
  let out = '';
  let i = 0;
  const n = str.length;
  while (i < n) {
    if (str[i] === '\\' && i + 1 < n && str[i + 1] === '|') { out += '|'; i += 2; continue; }
    out += str[i]; i++;
  }
  return out;
}

function splitTableRow(s) {
  const cells = [];
  let cur = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < n) {
      if (s[i + 1] === '|') { cur += '|'; i += 2; continue; }
      cur += s[i] + s[i + 1]; i += 2; continue;
    }
    if (ch === '`') {
      let j = i;
      while (j < n && s[j] === '`') j++;
      const len = j - i;
      let k = j;
      let close = -1;
      while (k < n) {
        if (s[k] === '`') {
          let m2 = k;
          while (m2 < n && s[m2] === '`') m2++;
          if (m2 - k === len) { close = k; break; }
          k = m2;
        } else k++;
      }
      if (close >= 0) { cur += resolveEscapedPipes(s.slice(i, close + len)); i = close + len; continue; }
      cur += s.slice(i, j); i = j; continue;
    }
    if (ch === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  cells.push(cur);
  // drop empty edge cells from leading/trailing pipes
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

// ---------------------------------------------------------------- main parse

function parseBlocks(src) {
  src = src.replace(/\r\n?/g, '\n');
  const raw = src.split('\n');
  const srcEndsNl = src.length > 0 && src[src.length - 1] === '\n';
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const lines = raw.map((s, idx) => ({
    s, pos: 0, col: 0, eol: idx < raw.length - 1 || srcEndsNl,
  }));
  const refs = new Map();
  const root = newBlock('doc', null);
  root.open = true;
  let atEof = false;
  // whether the line after the one being processed is blank (raw);
  // decides whether an html block ending at its end tag keeps its
  // last line's newline
  let nextIsBlank = false;
  const stack = [root]; // open blocks, root .. tip
  const tip = () => stack[stack.length - 1];

  function closeBlock(b) {
    b.open = false;
    if (b.t === 'paragraph') finalizeParagraph(b, refs);
    if (b.t === 'list') finalizeList(b);
    if (b.t === 'code' && !b.fenced) {
      // trailing blank lines are not part of indented code
      while (b.lines.length > 0) {
        const last = b.lines[b.lines.length - 1];
        if (last === '' || last === '\n') b.lines.pop();
        else break;
      }
    }
    if (b.t === 'code' && b.fenced) {
      // a fenced code block loses its last blank line before the
      // closing fence (a block of only blank lines loses one too:
      // two blank lines render as a single newline)
      const last = b.lines[b.lines.length - 1];
      if (last === '' || last === '\n') b.lines.pop();
      // a block whose only content is a single blank line renders empty
      if (b.lines.length === 1 && (b.lines[0] === '' || b.lines[0] === '\n')) b.lines.length = 0;
    }
    if (b.t === 'html' && !atEof && (!b.endReached || b.followedByBlank)) {
      // an html block loses its last line's newline when it ends at
      // a blank line, because its container closed, or because the
      // line after its end tag is blank; one that ends at its end
      // tag (or at EOF) with more content following keeps it
      const last = b.lines[b.lines.length - 1];
      if (last !== undefined && last.endsWith('\n')) {
        b.lines[b.lines.length - 1] = last.slice(0, -1);
      }
    }
  }
  function closeTo(depth) {
    // close blocks down to (but not including) stack[depth]
    while (stack.length > depth) closeBlock(stack.pop());
  }
  function addChild(parent, b) {
    if (parent.lastLineBlank) parent.hadBlankBetween = true;
    parent.lastLineBlank = false;
    parent.children.push(b);
    b.parent = parent;
    // a blank line's effect is consumed by the first block added
    // after it: deeper blocks must not make outer lists loose
    for (const s of stack) s.lastLineBlank = false;
    return b;
  }
  function addLineToLeaf(b, text) {
    b.lastLineBlank = false;
    b.lines.push(text);
  }
  // For code / html blocks: keep the line's terminator, so the literal
  // is the raw text. Trailing blank lines of indented code are dropped
  // when the block closes (see closeBlock).
  function addRawLine(b, line, text) {
    b.lastLineBlank = false;
    b.lines.push(text + (line.eol ? '\n' : ''));
  }

  // Try to match the open containers against the line. Returns the
  // stack depth that matched (containers below the tip that failed are
  // left for the caller to close), or -1 when a container failed.
  // On failure, `failDepth` is the depth of the first failing container.
  function matchContainers(line, explicit) {
    // stack: [root, c1, c2, ..., tip]. Only container blocks
    // (blockquote, list, item) are matched; the walk stops at the tip
    // when it is a leaf. explicit[d] is set when the container at
    // depth d was matched by a marker/indent actually present.
    for (let d = 1; d < stack.length; d++) {
      const b = stack[d];
      if (b.t === 'list') { explicit[d] = true; continue; } // transparent
      if (b.t !== 'blockquote' && b.t !== 'item') break; // leaf tip
      if (b.t === 'blockquote') {
        // up to 3 spaces, then '>'
        let p = line.pos;
        let col = line.col;
        let sp = 0;
        while (p < line.s.length && sp < 3) {
          const ch = line.s[p];
          if (ch === ' ') { sp++; p++; col++; }
          else if (ch === '\t') { const nc = col + (4 - (col % 4)); if (nc - line.col > 3) break; sp += nc - col; p++; col = nc; }
          else break;
        }
        if (p < line.s.length && line.s[p] === '>') {
          line.pos = p + 1;
          line.col = col + 1;
          // one optional space/tab
          if (line.pos < line.s.length && line.s[line.pos] === ' ') { line.pos++; line.col++; }
          else if (line.pos < line.s.length && line.s[line.pos] === '\t') advanceTo(line, line.col + 1);
          explicit[d] = true;
          continue;
        }
        return d; // failed at this container
      }
      if (b.t === 'item') {
        const savePos = line.pos, saveCol = line.col;
        // The item matches when the line (from the current cursor,
        // after container markers) is indented by at least the
        // item's content indent measured from the column where the
        // item's container content started (its base column) — the
        // indent is relative to that base, not absolute.
        const relIndent = b.contentIndent - b.baseCol;
        if (advanceTo(line, line.col + relIndent)) { explicit[d] = true; continue; }
        // the failed advance moved the cursor: restore it, so a new
        // block starting from this line sees its original indent
        line.pos = savePos; line.col = saveCol;
        // The item fails. A thematic break is not a new item, even
        // when it starts with a list marker: the list closes.
        if (matchThematicBreak(line)) return d - 1;
        // If the line starts a new item of the same list, only the
        // item closes; otherwise the list closes too (a non-item
        // block at the list's level is not part of it).
        const lm = matchListMarker(line);
        const parentList = b.parent;
        if (lm && parentList && parentList.t === 'list') {
          const same = (lm.kind === 'bullet' && parentList.listType === 'bullet' && parentList.bulletChar === lm.char) ||
            (lm.kind === 'ordered' && parentList.listType === 'ordered' && parentList.delim === lm.delim);
          if (same) return d;
        }
        return d - 1;
      }
      break; // unreachable: only containers reach here
    }
    return -1; // all matched
  }

  // Handle a blank line (raw, or blank after container markers were
  // consumed). It matches all containers vacuously, ends paragraphs /
  // tables / html blocks, and is content in code blocks and type-1
  // html blocks — but only when every container enclosing the tip was
  // explicitly matched on this line (a blank line outside a block
  // quote is not part of a code block inside it).
  function handleBlank(line, explicit, rawBlank) {
    const t = tip();
    let inside = true;
    // a blank line is inside a list item (the item continues across
    // blank lines) but not inside a blockquote it has no marker for
    for (let d = 1; d < stack.length - 1; d++) {
      const b = stack[d];
      if (b.t === 'blockquote' && !explicit[d]) { inside = false; break; }
    }
    if (t.t === 'code' && inside) {
      if (t.fenced) {
        advanceTo(line, line.col + t.fenceIndent);
        expandLeadingTabs(line);
        addRawLine(t, line, line.s.slice(line.pos));
      } else {
        advanceTo(line, line.col + 4);
        expandLeadingTabs(line);
        addRawLine(t, line, line.s.slice(line.pos));
      }
      // a blank line inside a code block is content, not a separator:
      // it does not mark the enclosing blocks as blank-separated
      return;
    }
    // a blank line outside the code block's containers ends it, and
    // also closes any blockquote the line had no marker for
    if (t.t === 'code' && !inside) {
      let ud = -1;
      for (let d = 1; d < stack.length; d++) {
        if (stack[d].t === 'blockquote' && !explicit[d]) { ud = d; break; }
      }
      closeTo(ud >= 0 ? ud : stack.length - 1);
    }
    if (t.t === 'html' && t.htmlType === 1 && inside) {
      addRawLine(t, line, line.s.slice(line.pos));
      return;
    }
    if (t.t === 'html' && t.htmlType >= 2 && t.htmlType <= 5 && inside) {
      // comment / processing instruction / declaration / CDATA end
      // only at their end tag: blank lines inside are content
      addRawLine(t, line, line.s.slice(line.pos));
      return;
    }
    // A whitespace-only remainder after container markers, with a
    // paragraph open, is paragraph content (the spaces are kept) —
    // only a remainder that is empty, or a raw blank line, ends it.
    if (!rawBlank && t.t === 'paragraph' && line.pos < line.s.length) {
      addLineToLeaf(t, line.s.slice(line.pos));
      return;
    }
    // close paragraph / table / html block at the tip if any
    if (t.t === 'paragraph' || t.t === 'table' || t.t === 'html') closeTo(stack.length - 1);
    // a blank line closes an empty list item (one with no content yet)
    const t2 = tip();
    if (t2.t === 'item' && t2.children.length === 0) closeTo(stack.length - 1);
    // A raw blank line (no markers at all) closes every open
    // blockquote; a blank line with markers stays inside it.
    if (rawBlank) {
      for (let d = 1; d < stack.length; d++) {
        if (stack[d].t === 'blockquote') { closeTo(d); break; }
      }
    }
    // Mark the blocks the blank line separates as blank-terminated,
    // but only up to the deepest container the line explicitly
    // matched: a blank line inside a blockquote does not separate
    // the list items outside it. A raw blank line (nothing matched)
    // separates at every level.
    let fromDepth = 0;
    for (let d = stack.length - 1; d >= 1; d--) {
      if (explicit[d]) { fromDepth = d; break; }
    }
    for (let d = fromDepth; d < stack.length; d++) stack[d].lastLineBlank = true;
  }
  function matchBlockquoteStart(line) {
    if (indentAt(line) > 3) return false;
    let p = line.pos;
    while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
    return p < line.s.length && line.s[p] === '>';
  }
  function interruptsParagraph(line) {
    if (matchThematicBreak(line)) return true;
    if (matchAtx(line)) return true;
    if (matchFence(line)) return true;
    if (matchHtmlBlock(line, true)) return true;
    if (matchBlockquoteStart(line)) return true;
    const lm = matchListMarker(line);
    if (lm) {
      // a non-empty list item interrupts a paragraph; an empty one
      // does too when it continues the list this paragraph is in.
      // An ordered list can only interrupt a paragraph when it
      // starts with 1 (unless it continues an existing list).
      let q = lm.markerPos + lm.markerLen;
      while (q < line.s.length && (line.s[q] === ' ' || line.s[q] === '\t')) q++;
      const nonEmpty = q < line.s.length;
      let continues = false;
      // the paragraph may sit inside a blockquote (or more) that is
      // itself inside a list item; walk up through blockquotes to
      // find the nearest enclosing list item and its list.
      let enc = tip().parent;
      while (enc && enc.t === 'blockquote') enc = enc.parent;
      if (enc && enc.t === 'item') {
        const lst = enc.parent;
        if (lst && lst.t === 'list') {
          continues = (lm.kind === 'bullet' && lst.listType === 'bullet' && lst.bulletChar === lm.char) ||
            (lm.kind === 'ordered' && lst.listType === 'ordered' && lst.delim === lm.delim);
        }
      }
      if (nonEmpty) {
        if (lm.kind === 'ordered' && lm.num !== 1) {
          // an ordered list must start with 1 to interrupt a
          // paragraph, unless the paragraph is already inside a
          // list item (a new list closing the old one)
          if (!(enc && enc.t === 'item')) return false;
        }
        return true;
      }
      if (continues) return true;
    }
    return false;
  }

  function processLine(line) {
    line.pos = 0; line.col = 0;
    const rawBlank = isBlankLine(line);
    // Match containers; record per-depth whether the container was
    // explicitly matched (a marker was present / the indent reached).
    // A raw blank line matches all containers vacuously (none explicit).
    const explicit = new Array(stack.length).fill(false);
    let fail = -1;
    if (!rawBlank) fail = matchContainers(line, explicit);
    // A whitespace-only line containing a tab inside a table is a
    // row of empty cells, not a blank line that ends the table; a
    // spaces-only line does end the table.
    const tableRowBlank = rawBlank && line.s.includes('\t') && tip().t === 'table';
    // After container matching the remainder may be blank (e.g. "> ").
    if ((rawBlank || isBlankLine(line)) && !tableRowBlank) {
      handleBlank(line, explicit, rawBlank);
      return;
    }
    if (fail >= 0) {
      // A container failed. Lazy continuation: if the tip is a
      // paragraph and the line does not start an interrupting block,
      // the line continues the paragraph as-is — except a line that
      // looks like a setext underline, which marked pads with 4
      // spaces so it cannot become a heading when re-parsed.
      const t = tip();
      if (t.t === 'paragraph' && !interruptsParagraph(line)) {
        // a container failed to match. When nothing was consumed
        // (line.pos is 0) the line's leading spaces are stripped;
        // when an outer container did match, the remainder after
        // its marker (including any leading space) is paragraph
        // content as-is.
        let txt = line.s.slice(line.pos);
        if (line.pos === 0) txt = txt.replace(/^[ \t]+/, '');
        if (/^(=+|-+)[ \t]*$/.test(txt)) addLineToLeaf(t, '    ' + txt);
        else addLineToLeaf(t, txt);
        return;
      }
      // A fenced code block's content lines are added even when the
      // list item fails to match: an unindented line stays code
      // content, it does not close the block or its list item.
      // A blockquote failure still closes it: the '>' marker is
      // required on every line inside a blockquote. But a fence
      // that has no content yet closes empty when its first line
      // breaks out of the list (e.g. a jsx fence whose first line
      // is unindented renders as an empty code block).
      if (t.t === 'code' && t.fenced && stack[fail] && stack[fail].t === 'list' && t.lines.length > 0) {
        // fall through to the main loop; the code branch adds it
      } else {
        closeTo(fail);
      }
    }

    // Start new blocks / add to the leaf, looping for containers.
    for (;;) {
      const t = tip();
      // --- fenced code content / closing fence
      if (t.t === 'code' && t.fenced) {
        // closing fence? indent<=3, same char, run >= fence len, rest blank
        if (indentAt(line) <= 3) {
          let p = line.pos;
          while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
          if (p < line.s.length && line.s[p] === t.fenceChar) {
            let n = 0;
            while (p + n < line.s.length && line.s[p + n] === t.fenceChar) n++;
            let q = p + n;
            let onlySpace = true;
            while (q < line.s.length) {
              if (line.s[q] !== ' ' && line.s[q] !== '\t') { onlySpace = false; break; }
              q++;
            }
            if (n >= t.fenceLen && onlySpace) {
              closeTo(stack.length - 1);
              return;
            }
          }
        }
        // content: remove up to fenceIndent columns, then expand
        // any leading tab that remains into spaces
        advanceTo(line, line.col + t.fenceIndent);
        expandLeadingTabs(line);
        addRawLine(t, line, line.s.slice(line.pos));
        return;
      }
      // --- indented code content
      if (t.t === 'code' && !t.fenced) {
        if (indentAt(line) >= 4) {
          advanceTo(line, line.col + 4);
          // a tab at the start of the content stays a tab
          addRawLine(t, line, line.s.slice(line.pos));
          return;
        }
        closeTo(stack.length - 1);
        continue;
      }
      // --- html block content
      if (t.t === 'html') {
        addRawLine(t, line, line.s.slice(line.pos));
        if (htmlEndReached(t, line.s.slice(line.pos))) {
          t.endReached = true;
          t.followedByBlank = nextIsBlank;
          closeTo(stack.length - 1);
        }
        return;
      }
      // --- table rows
      if (t.t === 'table') {
        // a row line: any non-blank line that does not start a new
        // block (heading, fence, thematic break, html 1-6, blockquote,
        // list). Indented lines are rows too.
        if (!interruptsParagraph(line)) {
          const cells = splitTableRow(line.s.slice(line.pos));
          t.rows.push(cells);
          return;
        }
        closeTo(stack.length - 1);
        continue;
      }
      // --- paragraph: setext / table delimiter / interruption /
      // continuation. Paragraph lines are added as-is from the cursor
      // (container markers and the item's content indent were already
      // consumed); leading spaces of the line are kept.
      if (t.t === 'paragraph') {
        const st = matchSetext(line);
        if (st) {
          // link reference definitions at the start of the paragraph
          // are stripped before the heading is formed; if nothing is
          // left, the underline is just paragraph text
          consumeLinkRefDefs(t, refs);
          if (t.lines.length === 0) {
            addLineToLeaf(t, line.s.slice(line.pos));
            return;
          }
          t.t = 'heading';
          t.level = st;
          // heading text is the paragraph's lines joined, with
          // leading/trailing whitespace of the whole text trimmed
          t.text = t.lines.join('\n').replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '');
          t.lines = [];
          closeTo(stack.length - 1);
          return;
        }
        if (t.lines.length === 1) {
          const aligns = matchTableDelimiter(line);
          if (aligns) {
            const headerCells = splitTableRow(t.lines[0]);
            // the delimiter row must have the same number of cells
            // as the header row, or this is not a table
            if (aligns.length === headerCells.length) {
              t.t = 'table';
              t.align = aligns;
              t.headerCells = headerCells;
              t.rows = [];
              t.lines = [];
              return;
            }
          }
        }
        if (interruptsParagraph(line)) {
          closeTo(stack.length - 1);
          continue;
        }
        addLineToLeaf(t, line.s.slice(line.pos));
        return;
      }

      // --- new block starts (tip is a container or heading etc.)
      // a non-item block at the list's level closes the list
      if (tip().t === 'list' && !matchListMarker(line)) closeTo(stack.length - 1);
      // thematic break
      if (matchThematicBreak(line)) {
        addChild(tip(), newBlock('thematic_break', null));
        return;
      }
      // ATX heading
      const atx = matchAtx(line);
      if (atx) {
        const hb = newBlock('heading', null);
        addChild(tip(), hb);
        hb.level = atx;
        let p = line.pos;
        while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
        p += atx;
        // the closing sequence is stripped from the remainder as it
        // stands (its leading space is the separator after the
        // opening marker), then the result is trimmed
        let text = line.s.slice(p);
        text = text.replace(/[ \t]+#+[ \t]*$/, '');
        text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        hb.text = text;
        return;
      }
      // fenced code
      const fence = matchFence(line);
      if (fence) {
        const cb = newBlock('code', null);
        addChild(tip(), cb);
        cb.fenced = true;
        cb.fenceChar = fence.char;
        cb.fenceLen = fence.len;
        cb.fenceIndent = fence.indent;
        let p = line.pos;
        while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
        p += fence.len;
        let info = line.s.slice(p).trim();
        // the language is the first word; backslash escapes in it are
        // resolved (ASCII punctuation only)
        if (info) {
          const w = info.split(/\s+/)[0];
          cb.info = w.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
        } else cb.info = '';
        stack.push(cb);
        return;
      }
      // HTML block
      const ht = matchHtmlBlock(line, tip().t === 'paragraph');
      if (ht) {
        const hb = newBlock('html', null);
        addChild(tip(), hb);
        hb.htmlType = ht;
        if (ht === 1) {
          const tagm = /^<\s*([A-Za-z]+)/.exec(line.s.slice(line.pos).trimStart());
          hb.endTag = '</' + (tagm ? tagm[1].toLowerCase() : 'script') + '>';
        }
        addRawLine(hb, line, line.s.slice(line.pos));
        stack.push(hb);
        if (htmlEndReached(hb, line.s.slice(line.pos))) {
          hb.endReached = true;
          hb.followedByBlank = nextIsBlank;
          closeTo(stack.length - 1);
          return;
        }
        return;
      }
      // blockquote
      if (indentAt(line) <= 3) {
        let p = line.pos;
        while (p < line.s.length && (line.s[p] === ' ' || line.s[p] === '\t')) p++;
        if (p < line.s.length && line.s[p] === '>') {
          const bq = newBlock('blockquote', null);
          addChild(tip(), bq);
          stack.push(bq);
          line.pos = p + 1;
          line.col = line.col + (p - line.pos) + 1; // recompute below
          line.col = 0;
          // recompute column properly: columns from line start
          line.col = colOf(line.s, line.pos);
          if (line.pos < line.s.length && line.s[line.pos] === ' ') { line.pos++; line.col++; }
          else if (line.pos < line.s.length && line.s[line.pos] === '\t') advanceTo(line, line.col + 1);
          // a blockquote with nothing after its marker is empty
          if (isBlankLine(line)) return;
          continue;
        }
      }
      // list item
      const lm = matchListMarker(line);
      if (lm) {
        let parent = tip();
        let list = null;
        const matches = (lst) =>
          (lm.kind === 'bullet' && lst.listType === 'bullet' && lst.bulletChar === lm.char) ||
          (lm.kind === 'ordered' && lst.listType === 'ordered' && lst.delim === lm.delim);
        if (parent.t === 'list') {
          // the tip is a list: reuse it when the marker matches,
          // otherwise close it and start a sibling list
          if (matches(parent)) list = parent;
          else { closeTo(stack.length - 1); parent = tip(); }
        }
        if (!list) {
          // reuse the last child list when the marker kind matches
          const sibs = parent.children;
          if (sibs.length > 0) {
            const last = sibs[sibs.length - 1];
            if (last.t === 'list' && last.open && matches(last)) list = last;
          }
        }
        if (!list) {
          list = newBlock('list', null);
          addChild(parent, list);
          list.listType = lm.kind;
          list.bulletChar = lm.char;
          list.delim = lm.delim;
          list.start = lm.kind === 'ordered' ? lm.num : null;
          stack.push(list);
        }
        const item = newBlock('item', null);
        addChild(list, item);
        // Content indent: marker column + marker length + following
        // spaces (1-4 counted, >=5 counts as 1); empty item => +1.
        // advanceTo handles a tab that straddles the boundary by
        // rewriting it as spaces and consuming only part of it.
        // baseCol is the cursor column where this item's container
        // content started (before the marker's leading spaces); the
        // content indent is measured from there when matching later
        // lines.
        const baseCol = line.col;
        const markerCol = colOf(line.s, lm.markerPos);
        line.pos = lm.markerPos + lm.markerLen;
        line.col = markerCol + lm.markerLen;
        let contentIndent;
        {
          let q = line.pos;
          let col = line.col;
          let spaces = 0;
          while (q < line.s.length && (line.s[q] === ' ' || line.s[q] === '\t')) {
            if (line.s[q] === ' ') { spaces++; col++; q++; }
            else {
              const nc = col + (4 - (col % 4));
              spaces += nc - col;
              col = nc;
              q++;
            }
          }
          if (q >= line.s.length) contentIndent = markerCol + lm.markerLen + 1;
          else if (spaces >= 5) contentIndent = markerCol + lm.markerLen + 1;
          else contentIndent = col;
        }
        item.contentIndent = contentIndent;
        item.markerOffset = markerCol;
        item.baseCol = baseCol;
        stack.push(item);
        if (!advanceTo(line, contentIndent)) {
          // only spaces remain to end of line: empty item
          line.pos = line.s.length;
          line.col = colOf(line.s, line.pos);
          return;
        }
        if (isBlankLine(line)) {
          // empty item: only spaces remain on this line
          line.pos = line.s.length;
          line.col = colOf(line.s, line.pos);
          return;
        }
        continue;
      }
      // indented code
      if (indentAt(line) >= 4) {
        const cb = newBlock('code', null);
        addChild(tip(), cb);
        cb.fenced = false;
        advanceTo(line, line.col + 4);
        addRawLine(cb, line, line.s.slice(line.pos));
        stack.push(cb);
        return;
      }
      // paragraph
      const pg = newBlock('paragraph', null);
      addChild(tip(), pg);
      stack.push(pg);
      addLineToLeaf(pg, line.s.slice(line.pos));
      return;
    }
  }

  function htmlEndReached(block, lineText) {
    const t = block.htmlType;
    if (t === 1) {
      const tag = block.endTag;
      return lineText.toLowerCase().indexOf(tag) >= 0;
    }
    if (t === 2) return lineText.indexOf('-->') >= 0;
    if (t === 3) return lineText.indexOf('?>') >= 0;
    if (t === 4) return lineText.indexOf('>') >= 0;
    if (t === 5) return lineText.indexOf(']]>') >= 0;
    return false;
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // a following line counts as blank here only when it is empty
    // or spaces-only; a tab-only line does not strip an html
    // block's trailing newline (same tab/content distinction as
    // table rows)
    const nx = li + 1 < lines.length ? lines[li + 1] : null;
    nextIsBlank = !!nx && /^[ ]*$/.test(nx.s);
    processLine(line);
  }
  atEof = true;
  closeTo(0);
  return { root, refs };
}

// Strip leading link reference definitions from a paragraph's lines
// (in place), registering each in refs. Returns the number of lines
// consumed.
function consumeLinkRefDefs(b, refs) {
  let i = 0;
  const lines = b.lines;
  while (i < lines.length) {
    const def = parseLinkRefDef(lines, i);
    if (!def) break;
    if (!refs.has(def.label)) refs.set(def.label, { dest: def.dest, title: def.title });
    i += def.linesUsed;
  }
  if (i > 0) b.lines = lines.slice(i);
  return i;
}

function finalizeParagraph(b, refs) {
  // Strip leading link reference definitions.
  consumeLinkRefDefs(b, refs);
  if (b.lines.length === 0) {
    // paragraph was only definitions: remove it from its parent
    const sibs = b.parent.children;
    const idx = sibs.indexOf(b);
    if (idx >= 0) sibs.splice(idx, 1);
    b.removed = true;
    return;
  }
  b.text = b.lines.join('\n');
}

function finalizeList(list) {
  let loose = false;
  if (list.hadBlankBetween) loose = true;
  const items = list.children;
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.hadBlankBetween) loose = true;
    if (idx < items.length - 1 && item.lastLineBlank) loose = true;
  }
  list.tight = !loose;
}

// column of char index pos in string s (tabs to next multiple of 4)
function colOf(s, pos) {
  let col = 0;
  for (let p = 0; p < pos && p < s.length; p++) {
    if (s[p] === '\t') col += 4 - (col % 4);
    else col++;
  }
  return col;
}

// ---------------------------------------------------------------- render

// Escape disallowed raw-HTML tag names inside an HTML block literal:
// <script, </style, ... become &lt;script, &lt;/style, ...
function escapeDisallowedTags(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === '<') {
      let j = i + 1;
      let close = false;
      if (s[j] === '/') { close = true; j++; }
      let k = j;
      while (k < n && (isAlnumCh(s[k]) || s[k] === '-')) k++;
      const name = s.slice(j, k).toLowerCase();
      if (name !== '' && DISALLOWED_TAGS.has(name)) {
        const after = s[k];
        if (after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '\r' || after === '>' || after === '/') {
          out += '&lt;';
          i++;
          continue;
        }
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

function renderBlocks(blocks, refs, tightParent) {
  let out = '';
  for (const b of blocks) out += renderBlock(b, refs, tightParent);
  return out;
}

function renderBlock(b, refs, tightParent) {
  switch (b.t) {
    case 'paragraph': {
      const text = b.text !== undefined ? b.text : b.lines.join('\n');
      if (tightParent) return parseInline(text, refs);
      return '<p>' + parseInline(text, refs) + '</p>\n';
    }
    case 'heading':
      return '<h' + b.level + '>' + parseInline(b.text, refs) + '</h' + b.level + '>\n';
    case 'code': {
      const literal = b.lines.join('');
      if (b.fenced) {
        let lang = '';
        if (b.info) {
          const w = b.info.split(/\s+/)[0];
          if (w) lang = ' class="language-' + escapeAttr(w) + '"';
        }
        return '<pre><code' + lang + '>' + escapeCode(literal) + '</code></pre>\n';
      }
      return '<pre><code>' + escapeCode(literal) + '</code></pre>\n';
    }
    case 'html':
      return b.lines.join('');
    case 'thematic_break':
      return '<hr>\n';
    case 'blockquote':
      return '<blockquote>\n' + renderBlocks(b.children, refs, false) + '</blockquote>\n';
    case 'list': {
      const tag = b.listType === 'ordered' ? 'ol' : 'ul';
      let open = '<' + tag;
      if (b.listType === 'ordered' && b.start !== 1) open += ' start="' + b.start + '"';
      open += '>\n';
      let out = open;
      for (const item of b.children) out += renderItem(item, refs, b.tight);
      out += '</' + tag + '>\n';
      return out;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let ci = 0; ci < b.headerCells.length; ci++) {
        const a = b.align[ci];
        out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(b.headerCells[ci].trim(), refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length > 0) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let ci = 0; ci < b.headerCells.length; ci++) {
            const a = b.align[ci];
            const cell = ci < row.length ? row[ci].trim() : '';
            out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + parseInline(cell, refs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody></table>\n';
      } else {
        out += '</table>\n';
      }
      return out;
    }
    default:
      return '';
  }
}

// Render one list item. The first paragraph may carry a GFM task-list
// checkbox: "[ ] " / "[x] " / "[X] " at the very start of its text.
function renderItem(item, refs, tight) {
  let out = '<li>';
  const kids = item.children;
  for (let idx = 0; idx < kids.length; idx++) {
    const k = kids[idx];
    if (idx === 0 && k.t === 'paragraph') {
      const text = k.text !== undefined ? k.text : k.lines.join('\n');
      const m = /^\[( |x|X)\]([ \t]|$|\n)/.exec(text);
      if (m) {
        const checked = m[1] === 'x' || m[1] === 'X';
        const box = checked
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">';
        // the checkbox replaces only "[ ]" / "[x]"; the whitespace
        // after it stays part of the item text. In a loose item the
        // checkbox goes inside the <p>.
        const rest = text.slice(3);
        if (tight) out += box + parseInline(rest, refs);
        else out += '<p>' + box + parseInline(rest, refs) + '</p>\n';
        continue;
      }
    }
    out += renderBlock(k, refs, tight);
  }
  out += '</li>\n';
  return out;
}

export function parse(markdown) {
  const { root, refs } = parseBlocks(markdown);
  return renderBlocks(root.children, refs, false);
}
