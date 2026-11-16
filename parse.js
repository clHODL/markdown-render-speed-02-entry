// A fast, dependency-free Markdown parser that renders exactly what marked
// 18.1.3 renders with its defaults (GFM on, breaks off, pedantic off).
// Written from scratch from the CommonMark 0.31.2 spec and the GFM spec,
// verified against marked's own outputs on the spec examples.
//
// Architecture: line-oriented block parser (recursive, container by container)
// plus a single-pass inline scanner with a delimiter stack for emphasis,
// strikethrough, links and images, following the CommonMark appendix A
// algorithm. No caching across calls: every parse() builds fresh state.

import { ENT } from './entities.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
function esc(s) {
  return s.replace(ESC_RE, (c) => ESC_MAP[c]);
}

// Escape for attribute values: escape < > " ' and & — but leave & alone
// when it starts a character reference (&name; or &#...;), which marked
// passes through verbatim inside attributes.
const ESC_ATTR_RE = /[<>"']|&(?!#?\w+;)/g;
function escAttr(s) {
  return s.replace(ESC_ATTR_RE, (c) => ESC_MAP[c]);
}

function isSpace(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}
function isAsciiPunct(c) {
  if (!c) return false;
  const n = c.charCodeAt(0);
  return (n >= 33 && n <= 47) || (n >= 58 && n <= 64) || (n >= 91 && n <= 96) || (n >= 123 && n <= 126);
}
function isDigit(c) {
  return c >= '0' && c <= '9';
}
function isAlphaNum(c) {
  return !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'));
}
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isUnicodePunct(c) {
  return !!c && PUNCT_RE.test(c);
}
function isWhitespace(c) {
  return !!c && /\s/.test(c);
}

// Number of columns the leading whitespace of `line` spans (tab = next
// multiple of 4), and the string index where that whitespace ends.
function leadingIndent(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') { col += 4 - (col % 4); i += 1; }
    else break;
  }
  return { col, idx: i };
}

// Remove `n` columns from the start of `line`, expanding tabs to spaces
// using their ORIGINAL column widths (the way container prefixes — list
// markers, blockquote markers — are stripped: a tab that follows the
// stripped region keeps its original width, so the remaining columns are
// preserved). Non-whitespace characters before the cut count as one column
// each (they are the indent/marker characters).
function stripColumns(line, n) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i += 1; }
      else {
        // The tab straddles the cut: its remainder becomes spaces, and
        // every tab in the whitespace run that follows is expanded to
        // spaces at its original width.
        let out = ' '.repeat(col + w - n);
        let c2 = col + w;
        let j = i + 1;
        while (j < line.length) {
          const d = line[j];
          if (d === ' ') { out += ' '; c2 += 1; j += 1; }
          else if (d === '\t') { const w2 = 4 - (c2 % 4); out += ' '.repeat(w2); c2 += w2; j += 1; }
          else break;
        }
        return out + line.slice(j);
      }
    } else { col += 1; i += 1; }
  }
  // The cut fell between characters: expand the whitespace run that
  // follows it to spaces at original widths.
  let out = '';
  let j = i;
  while (j < line.length) {
    const d = line[j];
    if (d === ' ') { out += ' '; col += 1; j += 1; }
    else if (d === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; j += 1; }
    else break;
  }
  return out + line.slice(j);
}

// Remove one column of whitespace at line[i] (a space or tab at original
// column `col`), expanding the whitespace run that follows it to spaces at
// original widths. Used after a blockquote '>'.
function stripOneWsColumn(line, i, col) {
  let out = '';
  if (line[i] === ' ') { i += 1; col += 1; }
  else { const w = 4 - (col % 4); out = ' '.repeat(w - 1); col += w; i += 1; }
  while (i < line.length) {
    const d = line[i];
    if (d === ' ') { out += ' '; col += 1; i += 1; }
    else if (d === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i += 1; }
    else break;
  }
  return out + line.slice(i);
}

// Remove `n` columns from the start of `line`, preserving tabs that lie
// entirely past the stripped region (only a tab straddling the boundary
// leaves spaces behind). Used for indented code blocks, where a tab in the
// content stays a tab.
function stripColumnsPreserve(line, n) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i += 1; }
      else return ' '.repeat(col + w - n) + line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}

// Fenced-code content strip: like stripColumnsPreserve, but a tab
// that straddles the fence indent is removed entirely instead of
// leaving remainder spaces (doc-13 evidence).
function stripFenceLine(line, n) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i += 1; }
      else return line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}

// A line is blank when it holds only spaces/tabs.
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Character / entity references
// ---------------------------------------------------------------------------

// Decode one entity reference at s[i] (s[i] === '&').
// Returns {kind:'num', ch, len} for a valid numeric reference (decoded
// character; 0 and surrogates become U+FFFD), {kind:'named', len} for a
// named reference `&name;` — known or unknown, the text is kept verbatim —
// or null when no reference is present at all (bare '&', no ';', or a
// numeric reference out of range).
function entityAt(s, i) {
  if (s[i + 1] === '#') {
    let j = i + 2;
    let hex = false;
    if (s[j] === 'x' || s[j] === 'X') { hex = true; j += 1; }
    const start = j;
    while (j < s.length) {
      const c = s[j];
      if (hex ? ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) : (c >= '0' && c <= '9')) j += 1;
      else break;
    }
    if (j === start || s[j] !== ';') return null;
    const num = parseInt(s.slice(start, j), hex ? 16 : 10);
    if (num > 0x10FFFF) return null;
    if (num === 0 || (num >= 0xD800 && num <= 0xDFFF)) return { kind: 'num', ch: '\uFFFD', len: j + 1 - i };
    return { kind: 'num', ch: String.fromCodePoint(num), len: j + 1 - i };
  }
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) j += 1;
    else break;
  }
  if (j === i + 1 || s[j] !== ';') return null;
  return { kind: 'named', len: j + 1 - i };
}

// Decode entities and backslash escapes inside a link destination / title /
// plain string (no inline structure). Named references stay verbatim
// (&ouml; in a href/title/info string is kept as-is); numeric references
// are decoded to their character.
function decodePlain(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length && isAsciiPunct(raw[i + 1])) {
      out += raw[i + 1];
      i += 2;
    } else if (c === '&') {
      const e = entityAt(raw, i);
      if (e) {
        if (e.kind === 'num') out += e.ch;
        else out += raw.slice(i, i + e.len);
        i += e.len;
      } else { out += '&'; i += 1; }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// Clean a link destination for the href attribute: decode escapes/entities,
// then percent-encode as a URI. encodeURI encodes '%' itself, but marked
// leaves '%' alone (both a bare '%' and an already-encoded %XX survive).
function cleanUrl(raw) {
  const decoded = decodePlain(raw);
  try {
    return encodeURI(decoded).replace(/%25/g, '%');
  } catch (_) {
    return decoded;
  }
}

// Normalize a link label: collapse internal whitespace to single spaces,
// trim, and case-fold. Only the escapes that shape the label itself are
// unescaped (\\, \[, \]); other backslash escapes stay as-is, so a label
// written with \! does not match the same label written without it. The
// case fold maps ß/ẞ to "ss" and ς to σ (Unicode case folding).
function normalizeLabel(label) {
  let out = '';
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '\\' && i + 1 < label.length && (label[i + 1] === '\\' || label[i + 1] === '[' || label[i + 1] === ']')) {
      out += label[i + 1]; i += 1; continue;
    }
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/ß/g, 'ss').replace(/ς/g, 'σ');
}

// Scan a link label starting at s[i] === '['. The label ends at the first
// unescaped ']' (nested brackets do not extend it), and a label containing
// an unescaped '[' is invalid. Returns {label, end} where end is the index
// just past that ']', or null.
function scanLabel(s, i) {
  // i points at '['
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && isAsciiPunct(s[j + 1])) { j += 2; continue; }
    if (c === '[') return null;
    if (c === ']') return { label: s.slice(i + 1, j), end: j + 1 };
    j += 1;
    if (j - i > 1000) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------
//
// Nodes: {t:'text',s} {t:'code',s} {t:'em'|'strong'|'del',children}
//        {t:'link',href,title,children} {t:'img',src,title,children}
//        {t:'html',s} {t:'br'} {t:'soft'} {t:'delim',ch,len,canOpen,canClose}
//        {t:'raw',s} (literal text that must not be escaped, e.g. an
//        unknown named entity reference)
//
// The scanner walks the text once, building a flat node list with delimiter
// nodes and resolving links/images on the fly with a bracket stack. Then
// processEmphasis() resolves the delimiter nodes into em/strong/del.

// Parse an inline HTML tag at s[i] === '<'. Returns the tag text and its
// length, or null when this is not a tag.
function scanHtmlTag(s, i) {
  const rest = s.slice(i);
  let m;
  // Comment: <!-- ... --> (also <!--> and <!--->)
  if (rest.startsWith('<!--')) {
    if (rest.startsWith('<!-->') || rest.startsWith('<!--->')) {
      return { text: rest.startsWith('<!-->') ? '<!-->' : '<!--->', len: rest.startsWith('<!-->') ? 5 : 6 };
    }
    const end = rest.indexOf('-->', 4);
    if (end === -1) return null;
    return { text: rest.slice(0, end + 3), len: end + 3 };
  }
  // Processing instruction <? ... ?>
  if (rest.startsWith('<?')) {
    const end = rest.indexOf('?>', 2);
    if (end === -1) return null;
    return { text: rest.slice(0, end + 2), len: end + 2 };
  }
  // Declaration <!A ... > or CDATA <![CDATA[ ... ]]>
  if (rest.startsWith('<![CDATA[')) {
    const end = rest.indexOf(']]>', 9);
    if (end === -1) return null;
    return { text: rest.slice(0, end + 3), len: end + 3 };
  }
  if (rest.startsWith('<!')) {
    m = /^<![A-Za-z][^>]*>/.exec(rest);
    if (m) return { text: m[0], len: m[0].length };
    return null;
  }
  // Open or close tag.
  m = /^<\/?[A-Za-z][A-Za-z0-9-]*/.exec(rest);
  if (!m) return null;
  let j = i + m[0].length;
  const closing = rest[1] === '/';
  // Attributes. Each attribute must be preceded by whitespace; an
  // attribute name starts with a letter or '_' and continues with
  // letters, digits, '.', '-', '_' or ':'.
  while (j < s.length) {
    let ws = 0;
    while (j < s.length && isSpace(s[j])) { j += 1; ws += 1; }
    if (j >= s.length) return null;
    const c = s[j];
    if (c === '>') return { text: s.slice(i, j + 1), len: j + 1 - i };
    if (c === '/') {
      if (closing) return null;
      if (s[j + 1] === '>') return { text: s.slice(i, j + 2), len: j + 2 - i };
      return null;
    }
    // A closing tag takes no attributes.
    if (closing) return null;
    // An attribute must be preceded by whitespace.
    if (ws === 0) return null;
    // Attribute name.
    if (!/[A-Za-z_]/.test(s[j])) return null;
    while (j < s.length && /[A-Za-z0-9_.:-]/.test(s[j])) j += 1;
    // Skip whitespace, optional = value. Only consume the whitespace
    // when an '=' follows it (otherwise it separates the next attribute).
    let k = j;
    while (k < s.length && isSpace(s[k])) k += 1;
    if (s[k] === '=') {
      j = k + 1;
      while (j < s.length && isSpace(s[j])) j += 1;
      if (j >= s.length) return null;
      const q = s[j];
      if (q === '"' || q === "'") {
        j += 1;
        const end = s.indexOf(q, j);
        if (end === -1) return null;
        j = end + 1;
      } else {
        const vStart = j;
        while (j < s.length) {
          const ch = s[j];
          if (isSpace(ch) || ch === '"' || ch === "'" || ch === '=' || ch === '<' || ch === '>' || ch === '`') break;
          j += 1;
        }
        if (j === vStart) return null;
      }
    }
  }
  return null;
}

// Percent-encode a string as a URI (used for autolink hrefs: marked
// percent-encodes backslashes here instead of decoding escapes first).
// As with cleanUrl, a '%' is left alone.
function encUri(s) {
  try { return encodeURI(s).replace(/%25/g, '%'); } catch (_) { return s; }
}

// Parse an autolink <...> at s[i] === '<'. Returns {href, text, len} or null.
function scanAutolink(s, i) {
  const end = s.indexOf('>', i + 1);
  if (end === -1 || end - i > 1000) return null;
  const inner = s.slice(i + 1, end);
  if (inner.length === 0 || inner.includes(' ') || inner.includes('\n') || inner.includes('<')) return null;
  // Scheme autolink: scheme ":" anything (no spaces).
  const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(inner);
  if (sm) {
    return { href: encUri(inner), text: inner, len: end + 1 - i };
  }
  // Email autolink.
  if (/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(inner)) {
    return { href: 'mailto:' + encUri(inner), text: inner, len: end + 1 - i };
  }
  return null;
}

// --- Extended autolinks (GFM) ----------------------------------------------

// Trim trailing punctuation from an extended autolink candidate, following
// the GFM rules: trailing . , ; : ? ! are dropped, an unmatched trailing )
// is dropped, and a trailing &...; that is not a valid entity is dropped
// from the '&' on.
function trimAutolinkTail(link) {
  let end = link.length;
  // Drop a trailing &xxx; that looks like an entity reference (an
  // alphanumeric name) but is not a valid entity. A &...; containing
  // other characters (e.g. &page=9;) is a query string, not an entity:
  // only the trailing ';' is punctuation there.
  const amp = link.lastIndexOf('&');
  if (amp !== -1 && link.endsWith(';') && amp > 0) {
    const name = link.slice(amp + 1, link.length - 1);
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(name) && ENT[name] === undefined) end = amp;
  }
  while (end > 0) {
    const c = link[end - 1];
    if (c === '.' || c === ',' || c === ';' || c === ':' || c === '?' || c === '!') { end -= 1; continue; }
    if (c === ')') {
      let open = 0, close = 0;
      for (let k = 0; k < end; k++) {
        if (link[k] === '(') open += 1;
        // A ')' immediately followed by ']' is a structural close of a
        // link destination, not part of this URL's paren balance.
        else if (link[k] === ')' && link[k + 1] !== ']') close += 1;
      }
      if (close > open) { end -= 1; continue; }
    }
    break;
  }
  return link.slice(0, end);
}

// Validate a domain: labels of alphanumerics/hyphens not starting or ending
// with '-', at least one dot, no empty labels.
function validDomain(dom) {
  if (!dom.includes('.')) return false;
  // Trailing dots (the DNS root) are allowed.
  dom = dom.replace(/\.+$/, '');
  if (!dom) return false;
  const labels = dom.split('.');
  for (const lab of labels) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(lab)) return false;
  }
  return true;
}

// Scan a domain + optional path starting at s[i] (i is at the first domain
// char). Returns the raw candidate (maximal run of non-space, non-'<' chars)
// or null.
function scanUriTail(s, i, inBracket) {
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '<') break;
    if (inBracket && c === ']') break;
    // Outside link text, a ']' followed by '(' ends the URL (the ']'
    // is the URL's last char) — but only when the '(' opens a group
    // that contains whitespace (a fresh link destination, not part of
    // this URL); a tight '(...)' group stays part of the URL.
    if (!inBracket && c === ']' && s[j + 1] === '(') {
      let depth = 0, k = j + 1, hasWs = false;
      while (k < s.length) {
        const d = s[k];
        if (d === ' ' || d === '\t' || d === '\n') { hasWs = true; break; }
        if (d === '(') depth += 1;
        else if (d === ')') { depth -= 1; if (depth === 0) break; }
        k += 1;
      }
      if (hasWs) { j += 1; break; }
    }
    j += 1;
  }
  return s.slice(i, j);
}

// Try an extended autolink starting at s[i]. `prev` is the char before i
// ('' at the start). Returns {href, text, len} or null.
// The domain part of a URL candidate: the maximal leading run of domain
// characters (letters, digits, '-', '.'). A query, fragment, path or
// stray backslash after the host does not belong to the domain.
function domainPrefix(s) {
  const m = /^[A-Za-z0-9.-]+/.exec(s);
  return m ? m[0] : '';
}

// A trailing run of _ or * at the end of a URL is not part of the URL
// when it would close an open emphasis delimiter (e.g. _text <url>_ or
// __text <url>__): trim it (and re-trim trailing punctuation) so the
// delimiter is seen as a delimiter.
function trimCloserRun(link, nodes) {
  if (!nodes) return link;
  // A URL may end in several stacked closers (e.g. '*__' closing an em
  // and a strong): trim them one run at a time until none applies.
  for (;;) {
    let trimmed = false;
    for (const ch of ['_', '*', '~']) {
      if (!link.endsWith(ch)) continue;
      let open = false;
      for (let k = nodes.length - 1; k >= 0; k--) {
        const nd = nodes[k];
        if (nd.t === 'delim' && nd.ch === ch && nd.canOpen) { open = true; break; }
      }
      if (!open) continue;
      let cut = 0;
      while (cut < link.length && link[link.length - 1 - cut] === ch) cut += 1;
      link = trimAutolinkTail(link.slice(0, link.length - cut));
      trimmed = true;
      break;
    }
    if (!trimmed) return link;
  }
}

function tryExtAutolink(s, i, prev, nodes, inBracket) {
  // Bare (extended) autolinks do not form inside link text: the URL
  // stays plain text and the outer link forms around it. Explicit
  // <...> autolinks still nest (handled by scanAutolink).
  if (inBracket) return null;
  // Nor after an opening <a> tag anywhere earlier in the document.
  if (bareAutolinkOff) return null;
  // The character before must not be a word char or a char that continues
  // the link (so we do not link the tail of a longer word).
  if (prev && (isAlphaNum(prev) || prev === '_' || prev === '-' || prev === '.' || prev === '/' || prev === ':')) return null;
  // www. autolink
  if (s.startsWith('www.', i)) {
    const tail = scanUriTail(s, i, inBracket);
    const link = trimCloserRun(trimAutolinkTail(tail), nodes);
    if (link.length <= 4) return null;
    // Domain is the leading domain-char run of the link.
    const dom = domainPrefix(link);
    if (!validDomain(dom)) return null;
    // A trailing escaped backslash (\\ in source) is one '\' in the
    // URL: it stays in both the href (encoded %5C) and the text.
    const url = link.split('\\\\').join('\\');
    return { href: 'http://' + encUri(url), text: url, len: link.length };
  }
  // Scheme autolink: scheme ':' (with //) or scheme ':' email...
  const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(s.slice(i, i + 34));
  if (sm) {
    const scheme = sm[0].slice(0, -1);
    const after = i + sm[0].length;
    if (s.startsWith('//', after)) {
      const tail = scanUriTail(s, after + 2, inBracket);
      const link = trimCloserRun(trimAutolinkTail(scheme + '://' + tail), nodes);
      if (link.length <= scheme.length + 3) return null;
      const domPart = link.slice(scheme.length + 3);
      const dom = domainPrefix(domPart);
      if (!validDomain(dom)) return null;
      const url = link.split('\\\\').join('\\');
      return { href: encUri(url), text: url, len: link.length };
    }
    // scheme ':' followed by an email address, optionally one /segment.
    const em = tryEmailAt(s, after, nodes);
    if (em) {
      let link = scheme + ':' + em.text;
      let end = after + em.len;
      if (s[end] === '/') {
        // One path segment (no further '/').
        let k = end + 1;
        while (k < s.length) {
          const c = s[k];
          if (c === ' ' || c === '\t' || c === '\n' || c === '<' || c === '/') break;
          k += 1;
        }
        if (k > end + 1) {
          const seg = s.slice(end, k);
          const trimmed = trimAutolinkTail(seg);
          if (trimmed.length > 1) { link += trimmed; end += trimmed.length; }
        }
      }
      return { href: encUri(link), text: link, len: end - i };
    }
    return null;
  }
  // Plain email autolink.
  const em = tryEmailAt(s, i, nodes);
  if (em) return { href: 'mailto:' + encUri(em.text), text: em.text, len: em.len };
  return null;
}

// Try to match an email address starting at s[i]. Returns {text, len} or
// null. The local part must start at i (i is its first char).
function tryEmailAt(s, i, nodes) {
  let j = i;
  // Local part.
  while (j < s.length) {
    const c = s[j];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
        ".!#$%&'*+/=?^_`{|}~-".includes(c)) j += 1;
    else break;
  }
  if (j === i || s[j] !== '@') return null;
  const local = s.slice(i, j);
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  j += 1;
  const domStart = j;
  while (j < s.length) {
    const c = s[j];
    if (isAlphaNum(c) || c === '-' || c === '.') j += 1;
    else break;
  }
  let dom = s.slice(domStart, j);
  // Trim trailing dots.
  while (dom.endsWith('.')) { dom = dom.slice(0, -1); j -= 1; }
  if (!validDomain(dom)) return null;
  // The char after the domain must not continue it (e.g. '+' or a word
  // char). A '_' only continues the word when it is not an emphasis
  // delimiter: it must either open emphasis itself, or close an open
  // '_' delimiter (e.g. _text foo@bar.com_).
  const after = s[j];
  if (after && (isAlphaNum(after) || after === '+' || after === '-')) return null;
  if (after === '_') {
    const d = mkDelim('_', 1, j > 0 ? s[j - 1] : '', j + 1 < s.length ? s[j + 1] : '');
    let open = d.canOpen;
    if (!open && nodes) {
      for (let k = nodes.length - 1; k >= 0; k--) {
        const nd = nodes[k];
        if (nd.t === 'delim' && nd.ch === '_' && nd.canOpen) { open = true; break; }
      }
    }
    if (!open) return null;
  }
  return { text: local + '@' + dom, len: j - i };
}

// --- Link destination / title parsing --------------------------------------

// Skip spaces, tabs and newlines starting at i. Returns the new index.
function skipInlineWs(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i += 1;
  return i;
}

// Parse a link destination starting at s[i]. Returns {dest, end} or null.
// dest is the raw destination text (escapes/entities still encoded).
function parseDest(s, i) {
  if (s[i] === '<') {
    let j = i + 1;
    let out = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '\n') return null;
      if (c === '>') return { dest: out, end: j + 1 };
      if (c === '<') return null;
      if (c === '\\' && j + 1 < s.length && isAsciiPunct(s[j + 1])) { out += s.slice(j, j + 2); j += 2; continue; }
      out += c;
      j += 1;
    }
    return null;
  }
  // Bare destination: no spaces/control chars, balanced parens.
  let j = i;
  let depth = 0;
  let out = '';
  while (j < s.length) {
    const c = s[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
    if (c === '(') { depth += 1; out += c; j += 1; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth -= 1; out += c; j += 1; continue;
    }
    if (c === '\\' && j + 1 < s.length && isAsciiPunct(s[j + 1])) { out += s.slice(j, j + 2); j += 2; continue; }
    if (c.charCodeAt(0) < 32) break;
    out += c;
    j += 1;
  }
  if (j === i) return null;
  return { dest: out, end: j };
}

// Parse a link title starting at s[i] (after whitespace). Returns
// {title, end} or null. Title is raw (escapes/entities still encoded).
function parseTitle(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== '(') return null;
  const close = q === '(' ? ')' : q;
  let j = i + 1;
  let out = '';
  while (j < s.length) {
    const c = s[j];
    if (c === close) return { title: out, end: j + 1 };
    if (c === '\\' && j + 1 < s.length && isAsciiPunct(s[j + 1])) { out += s.slice(j, j + 2); j += 2; continue; }
    if (c === '\n' && q === '(') return null;
    out += c;
    j += 1;
  }
  return null;
}

// Try to parse the tail of a link after the closing ']' at s[i] (i is the
// index just past ']'). `linkText` is the raw text of the link text (used
// for shortcut/collapsed references). Returns {href, title, end} or null.
// The '(' or '[' must follow ']' immediately (no whitespace). A failed
// inline link falls back to a shortcut reference; a full reference whose
// label parses but is not defined does not fall back.
function parseLinkTail(s, i, linkText, refs) {
  if (s[i] === '(') {
    let j = i + 1;
    j = skipInlineWs(s, j);
    let dest = '';
    let ok = false;
    if (s[j] === ')') {
      ok = true;
    } else {
      const d = parseDest(s, j);
      if (d) {
        dest = d.dest;
        j = d.end;
        j = skipInlineWs(s, j);
        let title = null;
        let titleOk = true;
        if (s[j] !== ')') {
          const t = parseTitle(s, j);
          if (!t) titleOk = false;
          else { title = t.title; j = t.end; j = skipInlineWs(s, j); }
        }
        if (titleOk && s[j] === ')') {
          return { href: cleanUrl(dest), title: title === null ? null : decodePlain(title), end: j + 1 };
        }
      }
    }
    if (ok) return { href: cleanUrl(dest), title: null, end: j + 1 };
    // Inline link failed: fall through to the shortcut reference.
  } else if (s[i] === '[') {
    const lab = scanLabel(s, i);
    if (lab) {
      const label = lab.label === '' ? linkText : lab.label;
      const ref = refs.get(normalizeLabel(label));
      if (ref) return { href: ref.href, title: ref.title, end: lab.end };
      return null; // label parsed but not defined: no shortcut fallback
    }
    // No closing ']': fall through to the shortcut reference.
  }
  // Shortcut reference.
  const ref = refs.get(normalizeLabel(linkText));
  if (!ref) return null;
  return { href: ref.href, title: ref.title, end: i };
}

// Plain-text rendering of a node list (for image alt text): formatting is
// stripped, code spans keep their literal text, HTML is dropped.
function plainText(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'raw') out += n.s;
    else if (n.t === 'code') out += n.s;
    else if (n.t === 'delim') out += n.ch.repeat(n.len);
    else if (n.t === 'br' || n.t === 'soft') out += '\n';
    else if (n.t === 'link' || n.t === 'em' || n.t === 'strong' || n.t === 'del' || n.t === 'img') out += plainText(n.children || []);
  }
  return out;
}

// --- The inline scanner -----------------------------------------------------

function inlineParse(s, refs) {
  const nodes = [];
  // Bracket stack: {idx (index in nodes of the '[' text node), imgIdx, image}
  const stack = [];
  let buf = '';
  let i = 0;
  const n = s.length;
  // After a multi-backtick code span fails because its closer search hit
  // a link-closing ']', the backtick run before that ']' is literal text
  // (it was the failed span's intended closer), not a new span opener.
  // noCodeUntil is the index of that ']'; -1 when inactive.
  let noCodeUntil = -1;
  // A link whose text held an unterminated multi-backtick span poisons
  // a later emphasis in the same paragraph when a code span follows
  // that emphasis (marked leaves the emphasis literal). Set to the
  // link node when such a link forms; null otherwise.
  let poisonLink = null;

  function flush() {
    if (buf) { nodes.push({ t: 'text', s: buf }); buf = ''; }
  }
  // Raw text of the link text: the nodes from the opener to now, rendered
  // as plain text (delimiters as their chars, code as literal).
  function linkTextOf(fromIdx) {
    let out = '';
    for (let k = fromIdx; k < nodes.length; k++) out += plainText([nodes[k]]);
    return out;
  }

  while (i < n) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') {
        flush(); nodes.push({ t: 'br' }); i += 2;
        // A hard break strips the leading whitespace of the next line.
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i += 1;
        continue;
      }
      if (nx !== undefined && isAsciiPunct(nx)) { buf += nx; i += 2; continue; }
      buf += '\\'; i += 1; continue;
    }
    if (c === '`') {
      // Code span: count the run, find a matching run.
      let run = 0;
      while (i + run < n && s[i + run] === '`') run += 1;
      if (i < noCodeUntil) { buf += '`'.repeat(run); i += run; continue; }
      let found = -1;
      let k = i + run;
      while (k < n) {
        // A multi-backtick code span must not swallow the ']' that
        // closes the link text we are inside: the link forms and the
        // backticks stay literal. Single-backtick spans may cross
        // ']' (cm-342/525/537).
        if (run >= 2 && s[k] === ']' && stack.length > 0 && (s[k + 1] === '(' || s[k + 1] === '[')) { noCodeUntil = k; break; }
        if (s[k] === '`') {
          let r2 = 0;
          while (k + r2 < n && s[k + r2] === '`') r2 += 1;
          if (r2 === run) { found = k; break; }
          k += r2;
        } else k += 1;
      }
      if (found === -1) { buf += '`'.repeat(run); i += run; continue; }
      let content = s.slice(i + run, found).replace(/\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && !/^[ ]+$/.test(content)) {
        content = content.slice(1, -1);
      }
      flush();
      nodes.push({ t: 'code', s: content });
      i = found + run;
      continue;
    }
    if (c === '[') {
      flush();
      nodes.push({ t: 'text', s: '[' });
      stack.push({ idx: nodes.length - 1, imgIdx: -1, image: false, src: i });
      i += 1;
      continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      flush();
      nodes.push({ t: 'text', s: '!' });
      nodes.push({ t: 'text', s: '[' });
      stack.push({ idx: nodes.length - 1, imgIdx: nodes.length - 2, image: true, src: i + 1 });
      i += 2;
      continue;
    }
    if (c === ']') {
      // Try to close a bracket.
      if (stack.length === 0) { buf += ']'; i += 1; continue; }
      const opener = stack[stack.length - 1];
      flush();
      // The shortcut/collapsed label is the RAW source text between the
      // brackets (backslash escapes stay as written, so [foo\!] does not
      // match a definition for [foo!]).
      const text = s.slice(opener.src + 1, i);
      const tail = parseLinkTail(s, i + 1, text, refs);
      if (!tail) {
        // Not a link: the opener is dead, ']' is literal.
        stack.pop();
        nodes.push({ t: 'text', s: ']' });
        i += 1;
        continue;
      }
      // A link may not contain another (bracket) link. An autolink
      // inside the text is fine and stays nested.
      let hasLink = false;
      for (let k = opener.idx + 1; k < nodes.length; k++) {
        if (nodes[k].t === 'link' && !nodes[k].auto) { hasLink = true; break; }
      }
      if (!opener.image && hasLink) {
        stack.pop();
        nodes.push({ t: 'text', s: ']' });
        i += 1;
        continue;
      }
      // A link whose text holds both an emphasis delimiter and a code
      // span containing a backtick does not form (marked's bracket
      // scanner loses the closing bracket in that combination).
      let hasBacktickCode = false, hasDelim = false;
      const scanLinkText = (list) => {
        for (const nd of list) {
          if (nd.t === 'code' && nd.s.includes('`')) hasBacktickCode = true;
          if (nd.t === 'delim' && (nd.ch === '*' || nd.ch === '_')) hasDelim = true;
          if (nd.children) scanLinkText(nd.children);
        }
      };
      scanLinkText(nodes.slice(opener.idx + 1));
      if (hasBacktickCode && hasDelim) {
        // The link does not form, and neither does the emphasis around
        // the code span: the delimiters stay literal.
        for (let k = opener.idx + 1; k < nodes.length; k++) {
          const nd = nodes[k];
          if (nd.t === 'delim' && (nd.ch === '*' || nd.ch === '_')) {
            nodes[k] = { t: 'text', s: nd.ch.repeat(nd.len) };
          }
        }
        stack.pop();
        nodes.push({ t: 'text', s: ']' });
        i += 1;
        continue;
      }
      const children = nodes.splice(opener.idx + 1);
      const startIdx = opener.image ? opener.imgIdx : opener.idx;
      const node = opener.image
        ? { t: 'img', src: tail.href, title: tail.title, children }
        : { t: 'link', href: tail.href, title: tail.title, children };
      nodes.splice(startIdx, nodes.length - startIdx, node);
      // This ']' stopped a multi-backtick code-span search, so the
      // link text holds an unterminated multi-backtick span.
      if (noCodeUntil === i && !opener.image) poisonLink = node;
      // Drop any openers that were inside the new link/image.
      while (stack.length && stack[stack.length - 1].idx > opener.idx) stack.pop();
      stack.pop();
      i = tail.end;
      continue;
    }
    if (c === '<') {
      const auto = scanAutolink(s, i);
      if (auto) {
        flush();
        nodes.push({ t: 'link', href: auto.href, title: null, auto: true, children: [{ t: 'text', s: auto.text }] });
        i += auto.len;
        continue;
      }
      const tag = scanHtmlTag(s, i);
      if (tag) {
        flush();
        // An opening <a> tag (even self-closing) turns bare autolinks
        // off until a closing </a> tag is seen. But <a/> (slash tight
        // against the name) does not: only <a>, <a ...> and <a ... />
        // with whitespace after the name count.
        if (/^<a[\s>]/i.test(tag.text)) bareAutolinkOff = true;
        else if (/^<\/a[\s>]/i.test(tag.text)) bareAutolinkOff = false;
        nodes.push({ t: 'html', s: tag.text }); i += tag.len; continue;
      }
      buf += '<'; i += 1; continue;
    }
    if (c === '&') {
      const e = entityAt(s, i);
      if (e) {
        flush();
        if (e.kind === 'named') nodes.push({ t: 'raw', s: s.slice(i, i + e.len) });
        else nodes.push({ t: 'text', s: e.ch });
        i += e.len;
        continue;
      }
      buf += '&'; i += 1; continue;
    }
    if (c === '\n') {
      // Soft or hard break. Trailing spaces in buf decide. A single
      // trailing space is kept (it is part of the text before a soft
      // break); a hard break strips the next line's leading whitespace.
      let sp = 0;
      while (sp < buf.length && buf[buf.length - 1 - sp] === ' ') sp += 1;
      if (sp >= 2) {
        buf = buf.slice(0, buf.length - sp);
        flush();
        nodes.push({ t: 'br' });
        i += 1;
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i += 1;
        continue;
      }
      flush();
      nodes.push({ t: 'soft' });
      i += 1;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let run = 0;
      while (i + run < n && s[i + run] === c) run += 1;
      flush();
      if (c === '~') {
        // A run of 1 or 2 tildes is a strikethrough delimiter; a run of
        // 3 or more is literal text.
        if (run >= 3) { buf += '~'.repeat(run); i += run; continue; }
        const before = i > 0 ? s[i - 1] : '';
        const after = i + run < n ? s[i + run] : '';
        nodes.push(mkDelim('~', run, before, after));
      } else {
        const before = i > 0 ? s[i - 1] : '';
        const after = i + run < n ? s[i + run] : '';
        nodes.push(mkDelim(c, run, before, after));
      }
      i += run;
      continue;
    }
    // Extended autolinks (www., scheme://, email).
    if (isAlphaNum(c) && (prev === '' || (!isAlphaNum(prev) && prev !== '_' && prev !== '-' && prev !== '.' && prev !== '/' && prev !== ':'))) {
      // Inside link text, a bare autolink does not form — but only when
      // the enclosing bracket can still become a link. If its text
      // already holds a (non-autolink) link, the bracket cannot become
      // one, so its content is ordinary text and autolinks form there
      // (e.g. the destination of a nested link that failed).
      let inBracket = false;
      if (stack.length > 0) {
        inBracket = true;
        const oIdx = stack[stack.length - 1].idx;
        for (let k = oIdx + 1; k < nodes.length; k++) {
          if (nodes[k].t === 'link' && !nodes[k].auto) { inBracket = false; break; }
        }
        // If the bracket cannot become a link at all (its label is
        // undefined and no inline destination follows), its content is
        // ordinary text and autolinks form there.
        if (inBracket) {
          const top = stack[stack.length - 1];
          const lab = scanLabel(s, top.src);
          if (!lab) inBracket = false;
          else if (!parseLinkTail(s, lab.end, lab.label, refs)) inBracket = false;
        }
      }
      const ext = tryExtAutolink(s, i, prev, nodes, inBracket);
      if (ext) {
        flush();
        nodes.push({ t: 'link', href: ext.href, title: null, auto: true, children: [{ t: 'text', s: ext.text }] });
        i += ext.len;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush();
  processEmphasis(nodes, poisonLink);
  return nodes;
}

function mkDelim(ch, len, before, after) {
  const afterWs = after === '' || isWhitespace(after);
  const beforeWs = before === '' || isWhitespace(before);
  const afterPunct = after !== '' && isUnicodePunct(after);
  const beforePunct = before !== '' && isUnicodePunct(before);
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
  let canOpen, canClose;
  if (ch === '_') {
    canOpen = leftFlanking && (!rightFlanking || beforePunct);
    canClose = rightFlanking && (!leftFlanking || afterPunct);
  } else {
    canOpen = leftFlanking;
    canClose = rightFlanking;
  }
  return { t: 'delim', ch, len, canOpen, canClose, before, after };
}

// --- Emphasis / strikethrough (CommonMark appendix A) -----------------------

function processEmphasis(nodes, poisonLink = null) {
  // Resolve emphasis inside link/image children first (their delimiters
  // cannot match delimiters outside the link).
  for (const nd of nodes) {
    if ((nd.t === 'link' || nd.t === 'img') && nd.children) processEmphasis(nd.children);
  }
  // If a link in this paragraph held an unterminated multi-backtick
  // span, an emphasis after that link does not form when a code span
  // follows the emphasis. The link's index is recomputed on every
  // check: emphasis formation splices nodes, so a cached index goes
  // stale.
  const poisoned = (closerIdx) => {
    if (!poisonLink) return false;
    const linkIdx = nodes.indexOf(poisonLink);
    if (linkIdx < 0 || closerIdx <= linkIdx) return false;
    // A code span counts even when it sits inside a later link/image.
    const hasCode = (list) => {
      for (const nd of list) {
        if (nd.t === 'code') return true;
        if (nd.children && hasCode(nd.children)) return true;
      }
      return false;
    };
    return hasCode(nodes.slice(closerIdx + 1));
  };
  const openers = [];
  let i = 0;
  while (i < nodes.length) {
    const nd = nodes[i];
    if (nd.t !== 'delim') { i += 1; continue; }
    let matched = false;
    if (nd.canClose) {
      for (let j = openers.length - 1; j >= 0; j--) {
        const o = openers[j];
        if (o.ch !== nd.ch) continue;
        if (nd.ch === '*' || nd.ch === '_') {
          const eitherBoth = (o.canOpen && o.canClose) || (nd.canOpen && nd.canClose);
          if (eitherBoth && (o.len + nd.len) % 3 === 0 && !((o.len % 3 === 0) && (nd.len % 3 === 0))) continue;
        }
        // Poisoned paragraph: a link with an unterminated multi-backtick
        // span came before this emphasis, and a code span follows it.
        if (poisoned(i)) continue;
        const use = o.len >= 2 && nd.len >= 2 ? 2 : 1;
        const oIdx = nodes.indexOf(o);
        const children = nodes.slice(oIdx + 1, i);
        // A strong whose opener was preceded by whitespace and whose
        // closer is followed by a letter blocks an outer single-'*'
        // em from forming around it (marked leaves the outer '*'s
        // literal in that case).
        if (use === 1 && nd.ch === '*') {
          let blocked = false;
          const scan = (list) => {
            for (const c of list) {
              if (c.t === 'strong' && c.blockOuter) { blocked = true; return; }
              if (c.children) scan(c.children);
              if (blocked) return;
            }
          };
          scan(children);
          if (blocked) continue;
        }
        const wrap = { t: use === 2 ? 'strong' : 'em', children };
        if (nd.ch === '~') wrap.t = 'del';
        if (use === 2) {
          const openPrevWs = o.before === '' || isWhitespace(o.before);
          const closeNextLetter = nd.after !== '' && !isWhitespace(nd.after) && /\p{L}/u.test(nd.after);
          if (openPrevWs && closeNextLetter) wrap.blockOuter = true;
        }
        o.len -= use;
        nd.len -= use;
        const repl = [];
        if (o.len > 0) repl.push(o);
        repl.push(wrap);
        if (nd.len > 0) repl.push(nd);
        nodes.splice(oIdx, i - oIdx + 1, ...repl);
        // Openers at or after o now live inside the new node: drop them.
        openers.length = j;
        // Re-examine from the opener's position: a leftover opener may
        // still match an earlier opener, and a leftover closer may match
        // the (leftover) opener.
        i = oIdx;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (nd.canOpen) openers.push(nd);
      i += 1;
    }
  }
  // Leftover delimiters are literal text, anywhere in the tree (a
  // delimiter left inside an em/strong/del child is literal too).
  const clean = (list) => {
    for (let k = 0; k < list.length; k++) {
      const nd = list[k];
      if (nd.t === 'delim') list[k] = { t: 'text', s: nd.ch.repeat(nd.len) };
      else if (nd.children) clean(nd.children);
    }
  };
  clean(nodes);
}

// --- Render inline nodes to HTML -------------------------------------------

function renderInline(nodes) {
  let out = '';
  for (const nd of nodes) {
    switch (nd.t) {
      case 'text': out += esc(nd.s); break;
      case 'raw': out += nd.s; break;
      case 'code': out += '<code>' + esc(nd.s) + '</code>'; break;
      case 'em': out += '<em>' + renderInline(nd.children) + '</em>'; break;
      case 'strong': out += '<strong>' + renderInline(nd.children) + '</strong>'; break;
      case 'del': out += '<del>' + renderInline(nd.children) + '</del>'; break;
      case 'link': {
        out += '<a href="' + escAttr(nd.href) + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escAttr(nd.title) + '"';
        out += '>' + renderInline(nd.children) + '</a>';
        break;
      }
      case 'img': {
        out += '<img src="' + escAttr(nd.src) + '" alt="' + escAttr(plainText(nd.children)) + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escAttr(nd.title) + '"';
        out += '>';
        break;
      }
      case 'html': out += nd.s; break;
      case 'br': out += '<br>'; break;
      case 'soft': out += '\n'; break;
    }
  }
  return out;
}

// Parse inline content of a paragraph / heading / table cell and render it.
function inline(s, refs) {
  return renderInline(inlineParse(s, refs));
}

// ---------------------------------------------------------------------------
// Block parsing (first pass: structure + link reference definitions; inline
// rendering happens afterwards, so a reference defined later in the document
// still resolves for an earlier block).
// ---------------------------------------------------------------------------
//
// Block nodes:
//  {k:'para', text}  {k:'h', level, text}  {k:'code', lang, text}
//  {k:'html', text}  {k:'hr'}  {k:'quote', children}
//  {k:'list', tag, start, loose, items:[{blocks, task}]}
//  {k:'table', aligns, header, rows}

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul']);

// Join lines[from..to) into raw text: each line plus its newline if it had one.
function joinRaw(lines, nl, from, to) {
  let out = '';
  for (let k = from; k < to; k++) out += lines[k] + (nl[k] ? '\n' : '');
  return out;
}

// --- HTML blocks ------------------------------------------------------------

// Match the start of an HTML block at lines[i]. `inParagraph` is true when
// we are looking for a block that may interrupt a paragraph (type 7 may
// not). Returns {type, end} where end is the index just past the block, or
// null. `lines`/`nl` are the full arrays.
function matchHtmlBlock(lines, nl, i, inParagraph) {
  const line = lines[i];
  const ind = leadingIndent(line);
  if (ind.col > 3) return null;
  const rest = line.slice(ind.idx);
  if (rest[0] !== '<') return null;
  const lower = rest.toLowerCase();
  let type = 0;
  let endMarker = null;
  const m1 = /^<(script|pre|style|textarea)([\s>]|$)/.exec(lower);
  if (m1) { type = 1; endMarker = '</' + m1[1]; }
  else if (lower.startsWith('<!--')) { type = 2; endMarker = '-->'; }
  else if (lower.startsWith('<?')) { type = 3; endMarker = '?>'; }
  else if (/^<![a-z]/.test(lower)) { type = 4; endMarker = '>'; }
  else if (lower.startsWith('<![cdata[')) { type = 5; endMarker = ']]>'; }
  else {
    const m6 = /^<\/?([a-z][a-z0-9-]*)([\s>]|$)/.exec(lower);
    if (m6 && BLOCK_TAGS.has(m6[1])) type = 6;
    else if (!inParagraph) {
      const tag = scanHtmlTag(rest, 0);
      if (tag && rest.slice(tag.len).trim() === '') type = 7;
    }
    if (!type) return null;
  }
  const N = lines.length;
  if (type <= 5) {
    // Ends at the first line containing the closing marker (the start line
    // itself counts).
    for (let j = i; j < N; j++) {
      if (lines[j].toLowerCase().includes(endMarker)) return { type, end: j + 1 };
    }
    return { type, end: N };
  }
  // Types 6 and 7 end at the first blank line.
  let j = i + 1;
  while (j < N && !isBlank(lines[j])) j += 1;
  return { type, end: j };
}

// --- Link reference definitions ---------------------------------------------

// Try to parse a link reference definition starting at lines[i].
// Returns the index just past the definition, or null. The label, the
// destination and the title may each be on the following line (a quote
// title may span several lines); the destination and title lines may be
// indented any amount.
function tryParseDef(lines, i, refs) {
  const line = lines[i];
  const ind = leadingIndent(line);
  if (ind.col > 3) return null;
  const rest = line.slice(ind.idx);
  if (rest[0] !== '[') return null;
  // Join this line and the following lines (up to a blank line) so the
  // label and the title may span lines.
  let text = line;
  const lineStart = [0];
  let count = 1;
  for (let k = i + 1; k < lines.length && count < 12; k++) {
    if (isBlank(lines[k])) break;
    text += '\n' + lines[k];
    lineStart.push(text.length - lines[k].length);
    count += 1;
  }
  const lineOf = (pos) => {
    let li = 0;
    for (let t = 1; t < lineStart.length; t++) {
      if (lineStart[t] <= pos) li = t; else break;
    }
    return li;
  };
  const lab = scanLabel(text, ind.idx);
  if (!lab || normalizeLabel(lab.label) === '') return null;
  let pos = lab.end;
  if (text[pos] !== ':') return null;
  pos += 1;
  // Skip whitespace to the destination; it must be on the label line or
  // the next line.
  let p2 = pos;
  let newlines = 0;
  while (p2 < text.length && (text[p2] === ' ' || text[p2] === '\t' || text[p2] === '\n')) {
    if (text[p2] === '\n') newlines += 1;
    p2 += 1;
  }
  if (p2 >= text.length || newlines > 1) return null;
  // Destination (on this line only; parseDest stops at a newline). Note
  // parseDest/parseTitle return absolute indices into `text`.
  const d = parseDest(text, p2);
  if (!d) return null;
  const href = cleanUrl(d.dest);
  pos = d.end;
  // Optional title. Whitespace must separate the destination from the
  // title, so a title glued to the destination is not a definition.
  let title = null;
  let titleEndPos = pos;
  let q = pos;
  let skipped = 0;
  while (q < text.length && (text[q] === ' ' || text[q] === '\t')) { q += 1; skipped += 1; }
  if (q < text.length && text[q] !== '\n') {
    if (skipped === 0) return null;
    const t = parseTitle(text, q);
    if (!t) return null;
    title = decodePlain(t.title);
    titleEndPos = t.end;
  } else if (q < text.length && text[q] === '\n') {
    // End of the destination line: a title may follow on the next line,
    // but only if it ends that line (otherwise the definition simply has
    // no title and the next line is a new block).
    let r = q + 1;
    while (r < text.length && (text[r] === ' ' || text[r] === '\t')) r += 1;
    if (r < text.length && text[r] !== '\n') {
      const t = parseTitle(text, r);
      if (t) {
        let e = t.end;
        while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e += 1;
        if (e >= text.length || text[e] === '\n') {
          title = decodePlain(t.title);
          titleEndPos = t.end;
        }
      }
    }
  }
  // Only spaces/tabs may remain on the final line.
  let e = titleEndPos;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e += 1;
  if (e < text.length && text[e] !== '\n') return null;
  const key = normalizeLabel(lab.label);
  if (!refs.has(key)) refs.set(key, { href, title });
  return i + lineOf(titleEndPos) + 1;
}

// --- Lists ------------------------------------------------------------------

function matchListMarker(line) {
  const ind = leadingIndent(line);
  if (ind.col > 3) return null;
  const start = ind.idx;
  // A thematic break line is not a list item.
  if (/^([-*_])([ \t]*\1){2,}[ \t]*$/.test(line.slice(start))) return null;
  let j = start;
  const c = line[j];
  let type, marker, num = 0;
  if (c === '-' || c === '+' || c === '*') {
    const nx = line[j + 1];
    if (nx !== ' ' && nx !== '\t' && nx !== undefined) return null;
    type = 'bullet'; marker = c; j += 1;
  } else if (isDigit(c)) {
    let k = j;
    while (k < line.length && isDigit(line[k])) k += 1;
    if (k - j > 9) return null;
    const delim = line[k];
    if (delim !== '.' && delim !== ')') return null;
    const nx = line[k + 1];
    if (nx !== ' ' && nx !== '\t' && nx !== undefined) return null;
    type = 'ordered'; marker = delim; num = parseInt(line.slice(j, k), 10); j = k + 1;
  } else return null;
  const markerEndCol = ind.col + (j - start);
  let col = markerEndCol;
  let k = j;
  let wsCols = 0;
  while (k < line.length && (line[k] === ' ' || line[k] === '\t')) {
    if (line[k] === ' ') { col += 1; wsCols += 1; k += 1; }
    else { const w = 4 - (col % 4); col += w; wsCols += w; k += 1; }
  }
  const empty = k >= line.length;
  let contentIndent;
  if (empty) contentIndent = markerEndCol + 1;
  else if (wsCols >= 5) contentIndent = markerEndCol + 1;
  else contentIndent = markerEndCol + wsCols;
  return { type, marker, num, indentCol: ind.col, markerEndCol, contentIndent, empty };
}

// Does this line (already stripped of leading indent) start a block that can
// interrupt a paragraph / end a lazy continuation?
function isBlockStart(rest, inList) {
  if (rest[0] === '>') return true;
  if (/^#{1,6}([ \t]|$)/.test(rest)) return true;
  const f = /^(`{3,}|~{3,})/.exec(rest);
  if (f) {
    if (f[0][0] === '`' && rest.slice(f[0].length).includes('`')) return false;
    return true;
  }
  if (/^([-*_])([ \t]*\1){2,}[ \t]*$/.test(rest)) return true;
  if (rest[0] === '<') {
    // HTML block types 1-6 (type 7 cannot interrupt, so it is not one).
    const lower = rest.toLowerCase();
    if (/^<(script|pre|style|textarea)([\s>]|$)/.test(lower)) return true;
    if (lower.startsWith('<!--') || lower.startsWith('<?') || /^<![a-z]/.test(lower) || lower.startsWith('<![cdata[')) return true;
    // A closing tag interrupts a paragraph only when its tag is a block
    // tag (type 6); closing tags of pre/script/style/textarea do not.
    const m6 = /^<\/?([a-z][a-z0-9-]*)([\s>]|$)/.exec(lower);
    if (m6 && BLOCK_TAGS.has(m6[1])) return true;
    return false;
  }
  // A list item interrupts a paragraph only when it has content, and an
  // ordered item only when it starts with 1 -- except inside a list item,
  // where any non-empty list marker interrupts (it starts a nested list).
  const lm = matchListMarker(rest);
  if (lm) {
    if (!lm.empty && (lm.type === 'bullet' || lm.num === 1 || inList)) return true;
    return false;
  }
  return false;
}

// A line that looks like a setext heading underline (indent <= 3, only
// '=' or '-' plus spaces).
function isSetextLine(line) {
  const ind = leadingIndent(line);
  if (ind.col > 3) return false;
  const r = line.slice(ind.idx);
  return /^=+[ \t]*$/.test(r) || /^-+[ \t]*$/.test(r);
}

// Collect one list item's lines starting at lines[j] (a marker line).
function collectItem(lines, nl, j, marker, listIndent) {
  const N = lines.length;
  const itemLines = [stripColumns(lines[j], marker.contentIndent)];
  const itemNl = [nl[j]];
  // Indices into itemLines that are lazy continuation lines: parseBlocks
  // must treat them as paragraph continuations, never as new block starts.
  const forceCont = new Set();
  let k = j + 1;
  let lastBlank = false;
  let hasContent = !marker.empty;
  // An item with no content yet is closed by a blank line: the following
  // lines are not part of it.
  let emptyClosed = false;
  // Inside a fenced code block, lines belong to the item regardless of
  // indent (a fence's content lines need not be indented) — but only
  // once the fence has established content in the item: if the first
  // line after the fence is unindented, the item ends and the fence is
  // empty.
  let inFence = false;
  let fenceCh = '';
  let fenceLen = 0;
  let fenceHasContent = false;
  const trackFence = (content) => {
    const fi = fenceInfo(content);
    if (!fi) return;
    if (!inFence) { inFence = true; fenceCh = fi.ch; fenceLen = fi.len; fenceHasContent = false; }
    else if (fi.ch === fenceCh && fi.len >= fenceLen && !fi.hasInfo) inFence = false;
  };
  // A fence may open on the marker line itself (e.g. '- ```').
  trackFence(itemLines[0]);
  while (k < N) {
    const l = lines[k];
    if (isBlank(l)) {
      // A blank line inside a fence is fence content, not a separator.
      if (inFence) { itemLines.push(''); itemNl.push(nl[k]); lastBlank = false; hasContent = true; k += 1; continue; }
      // Peek ahead: if the next non-blank line is not part of this item
      // (indented less than the content indent), this blank line belongs
      // to the outer context — it separates this item's block from the
      // next block — so leave it unconsumed.
      let m = k + 1;
      while (m < N && isBlank(lines[m])) m += 1;
      if (m < N && leadingIndent(lines[m]).col < marker.contentIndent) break;
      if (!hasContent) emptyClosed = true;
      itemLines.push(''); itemNl.push(nl[k]); lastBlank = true; k += 1; continue;
    }
    if (emptyClosed) break;
    const ind = leadingIndent(l);
    const r = l.slice(ind.idx);
    // Inside a fence, a line belongs to the item whatever its indent,
    // and a marker-looking line inside the fence does not end the item.
    // But an unindented line before the fence has any content ends the
    // item (the fence stays empty).
    if (inFence) {
      if (ind.col < marker.contentIndent && !fenceHasContent) break;
      if (ind.col >= marker.contentIndent) fenceHasContent = true;
      const stripped = ind.col >= marker.contentIndent ? stripColumns(l, marker.contentIndent) : l;
      itemLines.push(stripped);
      itemNl.push(nl[k]); lastBlank = false; hasContent = true; k += 1;
      trackFence(stripped);
      continue;
    }
    // A list marker less indented than this item's content indent ends
    // the item: a sibling item of the same list, or a different list.
    const mj = matchListMarker(l);
    if (mj && mj.indentCol < marker.contentIndent) break;
    if (ind.col >= marker.contentIndent) {
      const stripped = stripColumns(l, marker.contentIndent);
      itemLines.push(stripped);
      itemNl.push(nl[k]); lastBlank = false; hasContent = true; k += 1;
      trackFence(stripped);
      continue;
    }
    if (lastBlank) break;
    // A lazy line indented 4 or more is paragraph text, not a new block.
    if (ind.col <= 3 && isBlockStart(r)) break;
    // A setext-looking lazy line cannot be a setext underline: it is kept
    // as paragraph text, indented by 4 so it can never be one.
    if (isSetextLine(l)) itemLines.push('    ' + l);
    else {
      // A lazy line keeps its leading spaces as paragraph text, unless
      // it is indented 4 or more (then up to 4 columns are stripped,
      // cm-291) or it starts with a list marker (then the spaces are
      // stripped so the marker is literal text at column 0, cm-238/312).
      const stripped = stripColumnsPreserve(l, 4);
      itemLines.push(ind.col >= 4 || matchListMarker(stripped) !== null ? stripped : l);
    }
    forceCont.add(itemLines.length - 1);
    itemNl.push(nl[k]); lastBlank = false; hasContent = true; k += 1;
  }
  return { lines: itemLines, nl: itemNl, end: k, forceCont };
}

// --- Tables -----------------------------------------------------------------

// Split a table row on unescaped '|' characters (pipes inside code spans
// and escaped pipes do not split). An escaped pipe \| becomes a literal |
// in the cell (the backslash is consumed at the table level, so it also
// disappears inside code spans). Returns the raw cell strings.
function unescapePipe(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '|') { out += '|'; i += 2; continue; }
      if (s[i + 1] === '\\') { out += '\\\\'; i += 2; continue; }
    }
    out += s[i]; i += 1;
  }
  return out;
}

function splitTableRow(line) {
  const cells = [];
  let cur = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '\\' && i + 1 < n) {
      if (line[i + 1] === '|') { cur += '|'; i += 2; continue; }
      cur += line[i] + line[i + 1]; i += 2; continue;
    }
    if (c === '`') {
      let run = 0;
      while (i + run < n && line[i + run] === '`') run += 1;
      let found = -1;
      let k = i + run;
      while (k < n) {
        // A code span cannot cross a cell boundary: an unescaped '|'
        // ends the search (the span is unterminated in this cell).
        if (line[k] === '\\' && k + 1 < n) { k += 2; continue; }
        if (line[k] === '|') break;
        if (line[k] === '`') {
          let r2 = 0;
          while (k + r2 < n && line[k + r2] === '`') r2 += 1;
          if (r2 === run) { found = k; break; }
          k += r2;
        } else k += 1;
      }
      if (found === -1) { cur += '`'.repeat(run); i += run; continue; }
      cur += unescapePipe(line.slice(i, found + run));
      i = found + run;
      continue;
    }
    if (c === '|') { cells.push(cur); cur = ''; i += 1; continue; }
    cur += c;
    i += 1;
  }
  cells.push(cur);
  // A leading / trailing pipe makes an empty outer cell: drop it. The
  // row may start/end with whitespace around the pipe.
  const t = line.trim();
  if (cells.length > 1 && t[0] === '|') cells.shift();
  if (cells.length > 1) {
    let last = line.length - 1;
    while (last >= 0 && (line[last] === ' ' || line[last] === '\t')) last -= 1;
    if (last >= 0 && line[last] === '|' && !(last > 0 && line[last - 1] === '\\' && (last < 2 || line[last - 2] !== '\\'))) cells.pop();
  }
  return cells;
}

// Try to parse a table starting at lines[i] (header) and lines[i+1]
// (delimiter). Returns {node, end} or null.
function tryTable(lines, i) {
  const N = lines.length;
  if (i + 1 >= N) return null;
  const headerLine = lines[i];
  const delimLine = lines[i + 1];
  const dInd = leadingIndent(delimLine);
  if (dInd.col > 3) return null;
  if (!headerLine.includes('|') && !delimLine.includes('|')) return null;
  const header = splitTableRow(headerLine).map((c) => c.trim());
  const delimCells = splitTableRow(delimLine).map((c) => c.trim());
  if (delimCells.length !== header.length || delimCells.length === 0) return null;
  const aligns = [];
  for (const cell of delimCells) {
    const m = /^:?-+:?$/.exec(cell);
    if (!m) return null;
    if (cell.startsWith(':') && cell.endsWith(':') && cell.length > 1) aligns.push('center');
    else if (cell.endsWith(':')) aligns.push('right');
    else if (cell.startsWith(':')) aligns.push('left');
    else aligns.push(null);
  }
  const rows = [];
  let j = i + 2;
  while (j < N) {
    const l = lines[j];
    // A blank line of only spaces ends a table, but a whitespace-only
    // line containing a tab is a row of empty cells (and the following
    // line is a row too).
    if (isBlank(l) && !l.includes('\t')) break;
    const ind = leadingIndent(l);
    const r = l.slice(ind.idx);
    if (ind.col <= 3 && isBlockStart(r)) break;
    let cells = splitTableRow(l).map((c) => c.trim());
    while (cells.length < header.length) cells.push('');
    if (cells.length > header.length) cells.length = header.length;
    rows.push(cells);
    j += 1;
  }
  return { node: { k: 'table', aligns, header, rows }, end: j };
}

// --- Blockquotes ------------------------------------------------------------

// Collect a blockquote's lines starting at lines[i].
// Detect a fenced-code fence line: up to 3 leading spaces, then a run of
// 3+ backticks or tildes. Returns {ch, len, hasInfo} or null.
function fenceInfo(line) {
  const ind = leadingIndent(line);
  if (ind.col > 3) return null;
  const rest = line.slice(ind.idx);
  const m = /^(`{3,}|~{3,})/.exec(rest);
  if (!m) return null;
  // A backtick fence's info string cannot contain a backtick.
  if (m[0][0] === '`' && rest.slice(m[0].length).includes('`')) return null;
  return { ch: m[0][0], len: m[0].length, hasInfo: rest.slice(m[0].length).trim() !== '' };
}

function collectBlockquote(lines, nl, i) {
  const N = lines.length;
  const qLines = [];
  const qNl = [];
  // Indices into qLines that are lazy continuation lines (or whitespace-
  // only quote lines): parseBlocks must treat them as paragraph
  // continuations, never as new block starts or blank lines.
  const forceCont = new Set();
  let j = i;
  let inPara = false;
  // The indent (in columns) of the most recent '>' line in these lines:
  // when the quote itself is indented (e.g. inside a list item), a
  // space-led lazy line keeps its space (it is the remainder of an
  // outer tab already stripped by the container).
  let gtIndent = 0;
  // Inside a fenced code block, a lazy line ends the quote (a fence is
  // not a paragraph, so it has no lazy continuations).
  let inFence = false;
  let fenceCh = '';
  let fenceLen = 0;
  while (j < N) {
    const l = lines[j];
    const ind = leadingIndent(l);
    // A '>' line: up to 3 columns of indent, or a single tab before
    // the '>' (which counts as at most 3 columns of indent).
    if ((ind.col <= 3 || (l[0] === '\t' && l[1] === '>')) && l.slice(ind.idx).startsWith('>')) {
      gtIndent = ind.col;
      const gtIdx = ind.idx;
      const after = l[gtIdx + 1];
      let content;
      if (after === ' ' || after === '\t') content = stripOneWsColumn(l, gtIdx + 1, ind.col + 1);
      else content = l.slice(gtIdx + 1);
      qLines.push(content);
      qNl.push(nl[j]);
      // A whitespace-only content line (e.g. '>  ') is a paragraph
      // continuation, not a blank line, when a paragraph is open.
      if (content.length > 0 && isBlank(content)) forceCont.add(qLines.length - 1);
      const cInd = leadingIndent(content);
      // A paragraph line must be non-blank, indented <= 3 (an indented
      // line is code, not paragraph text), not a block start, and not a
      // setext underline. A list item or a nested blockquote can also
      // carry a lazy continuation (their first block is usually a
      // paragraph), so those count as paragraph lines too.
      const r0 = content.slice(cInd.idx);
      inPara = !isBlank(content) && cInd.col <= 3 && !isSetextLine(content) &&
        (r0[0] === '>' || matchListMarker(r0) !== null || !isBlockStart(r0));
      // Track fenced code blocks in the quote content.
      const fi = fenceInfo(content);
      if (fi) {
        if (!inFence) { inFence = true; fenceCh = fi.ch; fenceLen = fi.len; }
        else if (fi.ch === fenceCh && fi.len >= fenceLen && !fi.hasInfo) inFence = false;
      }
      if (inFence) inPara = false;
      j += 1;
      continue;
    }
    // A truly blank line (no '>') ends the quote, even if a '>' line
    // follows later.
    if (isBlank(l)) break;
    if (!inPara) break;
    const r = l.slice(ind.idx);
    if (ind.col <= 3 && isBlockStart(r)) break;
    // Lazy continuation line: a lazy line keeps its leading spaces as
    // paragraph text, unless it starts with a list marker (then the
    // spaces are stripped so the marker is literal text at column 0).
    // A tab before the blockquote '>' counts as at most 3 columns of
    // indent, so a tab-leading lazy line is stripped by 3, leaving 1
    // space. When the quote itself is indented, a space-led lazy line
    // keeps its space.
    if (isSetextLine(l)) qLines.push('    ' + l);
    else if (gtIndent > 0 && l[0] === ' ') qLines.push(l);
    else {
      const stripped = stripColumnsPreserve(l, l[0] === '\t' ? 3 : 4);
      qLines.push(ind.col >= 4 || matchListMarker(stripped) !== null ? stripped : l);
    }
    forceCont.add(qLines.length - 1);
    qNl.push(nl[j]);
    j += 1;
  }
  return { lines: qLines, nl: qNl, end: j, forceCont };
}

// --- The block loop ---------------------------------------------------------

function parseBlocks(lines, nl, refs, forceCont, inList) {
  const out = [];
  const N = lines.length;
  let i = 0;
  // `gap` is true when a blank line separates two top-level blocks in
  // this lines array (used to decide whether a list is loose: blank
  // lines inside a nested block do not count for the outer list).
  let gap = false;
  let sawBlock = false;
  let pendingGap = false;
  const pushBlock = (b) => {
    if (pendingGap) { gap = true; pendingGap = false; }
    out.push(b);
    sawBlock = true;
  };
  while (i < N) {
    const line = lines[i];
    if (isBlank(line)) { if (sawBlock) pendingGap = true; i += 1; continue; }
    const ind = leadingIndent(line);
    const rest = line.slice(ind.idx);

    // Indented code. A single tab before a '>' is a blockquote marker,
    // not indented code (the tab counts as at most 3 columns of indent
    // before a blockquote).
    if (ind.col >= 4 && !(line[0] === '\t' && line[1] === '>')) {
      const content = [];
      let j = i;
      while (j < N) {
        const l = lines[j];
        if (isBlank(l)) {
          let k = j + 1;
          while (k < N && isBlank(lines[k])) k += 1;
          if (k < N && leadingIndent(lines[k]).col >= 4) { content.push({ line: stripColumnsPreserve(l, 4), nl: nl[j] }); j += 1; continue; }
          break;
        }
        const ind2 = leadingIndent(l);
        if (ind2.col >= 4) { content.push({ line: stripColumnsPreserve(l, 4), nl: nl[j] }); j += 1; }
        else break;
      }
      while (content.length && content[content.length - 1].line === '') content.pop();
      let text = '';
      for (const c of content) text += c.line + (c.nl ? '\n' : '');
      pushBlock({ k: 'code', lang: null, text });
      i = j;
      continue;
    }

    // Fenced code.
    const fence = /^(`{3,}|~{3,})/.exec(rest);
    if (fence) {
      const ch = fence[0][0];
      const len = fence[0].length;
      const info = rest.slice(len);
      if (!(ch === '`' && info.includes('`'))) {
        const content = [];
        let j = i + 1;
        let closed = false;
        while (j < N) {
          const l = lines[j];
          const ind2 = leadingIndent(l);
          const r = l.slice(ind2.idx);
          if (ind2.col <= 3 && r[0] === ch) {
            const m = new RegExp('^\\' + ch + '{' + len + ',}[ \\t]*$').exec(r);
            if (m) { closed = true; break; }
          }
          // A tilde fence does not strip its content at all; a backtick
          // fence strips by its indent (but only the first 3 columns
          // count as fence indent — a further-indented backtick fence
          // strips only the excess over 3).
          const stripN = ch === '~' ? 0 : (ind.col <= 3 ? ind.col : ind.col - 3);
          content.push({ line: stripFenceLine(l, stripN), nl: nl[j] });
          j += 1;
        }
        // A single trailing empty line before the closing fence is not
        // part of the code (the content ends with a blank line, so the
        // newline just before the fence belongs to the fence). A fence
        // whose only content is a blank line is empty.
        if (content.length >= 1 && content[content.length - 1].line === '') content.pop();
        const infoTrim = info.trim();
        const lang = infoTrim === '' ? null : decodePlain(infoTrim.split(/[ \t]+/)[0]);
        let text = '';
        for (const c of content) text += c.line + (c.nl ? '\n' : '');
        pushBlock({ k: 'code', lang, text });
        i = closed ? j + 1 : j;
        continue;
      }
    }

    // ATX heading.
    const atx = /^(#{1,6})([ \t]|$)/.exec(rest);
    if (atx) {
      // Work on the text after the opening hashes (including the separator
      // space) so a closing sequence that is the whole content is still
      // recognised as preceded by a space.
      let text = rest.slice(atx[1].length);
      text = text.replace(/[ \t]+$/, '');
      text = text.replace(/[ \t]+#+$/, '');
      text = text.replace(/^[ \t]+/, '');
      pushBlock({ k: 'h', level: atx[1].length, text });
      i += 1;
      continue;
    }

    // Thematic break.
    if (/^([-*_])([ \t]*\1){2,}[ \t]*$/.test(rest)) {
      pushBlock({ k: 'hr' });
      i += 1;
      continue;
    }

    // HTML block.
    const html = matchHtmlBlock(lines, nl, i, false);
    if (html) {
      // Whether the block keeps its trailing newline depends on what
      // follows it: if it runs to the end of this lines array it keeps it
      // only when it is the document's last block; if another line
      // follows, it keeps it only when that line is not blank.
      pushBlock({
        k: 'html',
        text: joinRaw(lines, nl, i, html.end),
        htype: html.type,
        endAtEnd: html.end >= N,
        // Types 6/7 end at the first blank line, so ending before the
        // array end means a blank line follows (even a whitespace-only
        // one) and the trailing newline drops. Types 1-5 end at a
        // marker, so only a truly empty next line drops it.
        nextBlank: html.type >= 6
          ? html.end < N
          : (html.end < N && lines[html.end] === ''),
      });
      i = html.end;
      continue;
    }

    // Blockquote.
    if (rest[0] === '>') {
      const q = collectBlockquote(lines, nl, i);
      pushBlock({ k: 'quote', children: parseBlocks(q.lines, q.nl, refs, q.forceCont, inList) });
      i = q.end;
      continue;
    }

    // List.
    const marker = matchListMarker(line);
    if (marker) {
      const listIndent = marker.indentCol;
      const items = [];
      let j = i;
      // A sibling item may be indented differently from the first item:
      // it must be indented at least as much as the list itself, at most
      // 3, and less than the previous item's content indent (otherwise
      // it is nested inside the previous item).
      let prevContentIndent = Infinity;
      let blankBetweenItems = false;
      while (j < N) {
        // Blank lines between items: only skip them when another item
        // follows (otherwise leave them for the outer context, where
        // they separate this list from the next block).
        let k = j;
        while (k < N && isBlank(lines[k])) k += 1;
        if (k >= N) break;
        const mj = matchListMarker(lines[k]);
        if (!mj || mj.type !== marker.type || mj.marker !== marker.marker) break;
        if (mj.indentCol > 3 || mj.indentCol >= prevContentIndent) break;
        if (k > j && items.length > 0) blankBetweenItems = true;
        j = k;
        items.push(collectItem(lines, nl, j, mj, listIndent));
        prevContentIndent = mj.contentIndent;
        j = items[items.length - 1].end;
      }
      const rendered = items.map((it) => {
        // Task list marker on the first non-blank line of the item.
        let ls = it.lines;
        let nls = it.nl;
        let task = null;
        for (let t = 0; t < ls.length; t++) {
          if (isBlank(ls[t])) continue;
          const m = /^\[( |x|X)\]([ \t]|$)/.exec(ls[t]);
          if (m) {
            const after = ls[t].slice(m[0].length);
            if (!isBlockStart(after) && after.trim() !== '```' && !/^(`{3,}|~{3,})/.test(after)) {
              task = m[1] === ' ' ? ' ' : 'x';
              ls = ls.slice();
              ls[t] = after;
            }
          }
          break;
        }
        const blocks = parseBlocks(ls, nls, refs, it.forceCont, true);
        return { blocks, task, gap: blocks.gap };
      });
      // Loose when a blank line separates two blocks inside an item
      // (blank lines inside a nested block do not count for the outer
      // list), or when trailing blank lines separate one item from the
      // next (a blank line after an empty item's marker counts too).
      let loose = false;
      for (let t = 0; t < items.length; t++) {
        if (rendered[t].gap) { loose = true; break; }
        if (t < items.length - 1) {
          const ls = items[t].lines;
          let lastNonBlank = -1;
          for (let k = 0; k < ls.length; k++) if (!isBlank(ls[k])) lastNonBlank = k;
          if (ls.length > 1 && lastNonBlank < ls.length - 1) { loose = true; break; }
        }
      }
      if (blankBetweenItems && items.length > 1) loose = true;
      pushBlock({ k: 'list', tag: marker.type === 'bullet' ? 'ul' : 'ol', start: marker.type === 'ordered' ? marker.num : 1, loose, items: rendered });
      i = j;
      continue;
    }

    // Paragraph (link reference definitions first, then the paragraph).
    let p = i;
    while (p < N) {
      const end = tryParseDef(lines, p, refs);
      if (end === null) break;
      p = end;
    }
    // Definitions consumed after a blank line count as content for the
    // gap (a blank line before a definition still separates blocks).
    if (p > i && sawBlock && pendingGap) { gap = true; pendingGap = false; }
    if (p >= N || isBlank(lines[p])) { i = p; continue; }
    // After consuming definitions the next line may start a different
    // block (blockquote, list, heading, ...) rather than a paragraph.
    // (A list marker starts a block here even when it could not interrupt
    // a paragraph, e.g. an empty item or an ordered item not starting
    // with 1.)
    {
      const indP = leadingIndent(lines[p]);
      if (indP.col <= 3) {
        const rP = lines[p].slice(indP.idx);
        if (isBlockStart(rP, inList) || matchListMarker(rP)) { i = p; continue; }
      }
    }
    // Table?
    const table = tryTable(lines, p);
    if (table) { pushBlock(table.node); i = table.end; continue; }
    const textLines = [lines[p]];
    let j = p + 1;
    let heading = null;
    while (j < N) {
      const l = lines[j];
      // A forced continuation line (lazy quote line, whitespace-only
      // quote line) is part of this paragraph, whatever it looks like.
      if (forceCont && forceCont.has(j)) { textLines.push(l); j += 1; continue; }
      if (isBlank(l)) break;
      const ind2 = leadingIndent(l);
      if (ind2.col <= 3) {
        const r = l.slice(ind2.idx);
        if (/^=+[ \t]*$/.test(r)) { heading = 1; break; }
        if (/^-+[ \t]*$/.test(r)) { heading = 2; break; }
        if (isBlockStart(r, inList)) break;
      }
      textLines.push(l);
      j += 1;
    }
    if (heading !== null) {
      pushBlock({ k: 'h', level: heading, text: textLines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '') });
      i = j + 1;
      continue;
    }
    pushBlock({ k: 'para', text: textLines.join('\n') });
    i = j;
  }
  out.gap = gap;
  return out;
}

// --- Rendering ---------------------------------------------------------------

// Render a block list. `lastInDoc` is true when this list is the tail of
// the whole document: the last block of such a list is the document's last
// block, which matters for HTML blocks (type 6/7 keep their trailing
// newline only there).
function renderBlocks(blocks, refs, lastInDoc) {
  let out = '';
  for (let t = 0; t < blocks.length; t++) {
    out += renderBlock(blocks[t], refs, !!lastInDoc && t === blocks.length - 1);
  }
  return out;
}

function renderBlock(b, refs, isLast) {
  switch (b.k) {
    case 'para': return '<p>' + inline(b.text, refs) + '</p>\n';
    case 'h': return '<h' + b.level + '>' + inline(b.text, refs) + '</h' + b.level + '>\n';
    case 'code':
      return '<pre><code' + (b.lang ? ' class="language-' + escAttr(b.lang) + '"' : '') + '>' + esc(b.text) + '</code></pre>\n';
    case 'html': {
      // The trailing newline is kept when the block runs to the end of
      // its lines array and is the document's last block, or when the
      // next line in its array is not blank; otherwise it is dropped.
      let t = b.text;
      const keep = b.endAtEnd ? isLast : !b.nextBlank;
      if (!keep && t.endsWith('\n')) t = t.slice(0, -1);
      return t;
    }
    case 'hr': return '<hr>\n';
    case 'quote': return '<blockquote>\n' + renderBlocks(b.children, refs, isLast) + '</blockquote>\n';
    case 'list': {
      let out = '<' + b.tag + (b.tag === 'ol' && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>\n';
      for (let ti = 0; ti < b.items.length; ti++) {
        const it = b.items[ti];
        const itemLast = isLast && ti === b.items.length - 1;
        let inner = '';
        const blocks = it.blocks;
        // In a tight list every paragraph is rendered as bare inline
        // content (no <p> tags); in a loose list every paragraph keeps
        // its <p> tags.
        for (let t = 0; t < blocks.length; t++) {
          const blk = blocks[t];
          if (!b.loose && blk.k === 'para') inner += inline(blk.text, refs);
          else inner += renderBlock(blk, refs, itemLast && t === blocks.length - 1);
        }
        if (it.task !== null) {
          const input = it.task === 'x'
            ? '<input checked="" disabled="" type="checkbox">'
            : '<input disabled="" type="checkbox">';
          if (b.loose && blocks.length > 0 && blocks[0].k === 'para') {
            inner = '<p>' + input + ' ' + inline(blocks[0].text, refs) + '</p>\n' + blocks.slice(1).map((blk, idx) => renderBlock(blk, refs, itemLast && idx + 1 === blocks.length - 1)).join('');
          } else {
            inner = input + (inner ? ' ' + inner : '');
          }
        }
        out += '<li>' + inner + '</li>\n';
      }
      out += '</' + b.tag + '>\n';
      return out;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let c = 0; c < b.header.length; c++) {
        out += '<th' + (b.aligns[c] ? ' align="' + b.aligns[c] + '"' : '') + '>' + inline(b.header[c], refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length > 0) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let c = 0; c < row.length; c++) {
            out += '<td' + (b.aligns[c] ? ' align="' + b.aligns[c] + '"' : '') + '>' + inline(row[c], refs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
      return out;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Once an opening <a> tag is seen in inline content, marked stops
// forming bare (extended) autolinks until a closing </a> tag is seen.
// Regular [text](url) links and explicit <...> autolinks are
// unaffected. Reset per parse().
let bareAutolinkOff = false;

export function parse(markdown) {
  if (markdown === '') return '';
  bareAutolinkOff = false;
  const src = markdown.replace(/\r\n?/g, '\n');
  let lines = src.split('\n');
  const endsWithNL = src.endsWith('\n');
  if (endsWithNL) lines.pop();
  const nl = lines.map((_, idx) => idx < lines.length - 1 || endsWithNL);
  const refs = new Map();
  const blocks = parseBlocks(lines, nl, refs);
  return renderBlocks(blocks, refs, true);
}
