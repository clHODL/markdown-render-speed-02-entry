// A fast, dependency-free Markdown parser that renders exactly what marked
// 18.1.3 renders with its defaults (GFM on, breaks off). Written from the
// CommonMark 0.31.2 and GFM 0.29 specifications, plus the behaviour the
// practice cases' expected outputs pin down where marked departs from them.
// No tables of case outputs, no memoisation across calls: every call parses
// the string it is given, from scratch, and keeps nothing afterwards.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  iexcl: '\u00a1', cent: '\u00a2', pound: '\u00a3', curren: '\u00a4',
  yen: '\u00a5', brvbar: '\u00a6', sect: '\u00a7', uml: '\u00a8',
  copy: '\u00a9', ordf: '\u00aa', laquo: '\u00ab', not: '\u00ac',
  shy: '\u00ad', reg: '\u00ae', macr: '\u00af', deg: '\u00b0',
  plusmn: '\u00b1', sup2: '\u00b2', sup3: '\u00b3', acute: '\u00b4',
  micro: '\u00b5', para: '\u00b6', middot: '\u00b7', cedil: '\u00b8',
  sup1: '\u00b9', ordm: '\u00ba', raquo: '\u00bb', frac14: '\u00bc',
  frac12: '\u00bd', frac34: '\u00be', iquest: '\u00bf', Agrave: '\u00c0',
  Aacute: '\u00c1', Acirc: '\u00c2', Atilde: '\u00c3', Auml: '\u00c4',
  Aring: '\u00c5', AElig: '\u00c6', Ccedil: '\u00c7', Egrave: '\u00c8',
  Eacute: '\u00c9', Ecirc: '\u00ca', Euml: '\u00cb', Igrave: '\u00cc',
  Iacute: '\u00cd', Icirc: '\u00ce', Iuml: '\u00cf', ETH: '\u00d0',
  Ntilde: '\u00d1', Ograve: '\u00d2', Oacute: '\u00d3', Ocirc: '\u00d4',
  Otilde: '\u00d5', Ouml: '\u00d6', times: '\u00d7', Oslash: '\u00d8',
  Ugrave: '\u00d9', Uacute: '\u00da', Ucirc: '\u00db', Uuml: '\u00dc',
  Yacute: '\u00dd', THORN: '\u00de', szlig: '\u00df', agrave: '\u00e0',
  aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3', auml: '\u00e4',
  aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7', egrave: '\u00e8',
  eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb', igrave: '\u00ec',
  iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef', eth: '\u00f0',
  ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3', ocirc: '\u00f4',
  otilde: '\u00f5', ouml: '\u00f6', divide: '\u00f7', oslash: '\u00f8',
  ugrave: '\u00f9', uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc',
  yacute: '\u00fd', thorn: '\u00fe', yuml: '\u00ff', OElig: '\u0152',
  oelig: '\u0153', Scaron: '\u0160', scaron: '\u0161', Yuml: '\u0178',
  fnof: '\u0192', circ: '\u02c6', tilde: '\u02dc', ensp: '\u2002',
  emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d',
  lrm: '\u200e', rlm: '\u200f', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a', ldquo: '\u201c',
  rdquo: '\u201d', bdquo: '\u201e', dagger: '\u2020', Dagger: '\u2021',
  permil: '\u2030', lsaquo: '\u2039', rsaquo: '\u203a', oline: '\u203e',
  frasl: '\u2044', euro: '\u20ac', image: '\u2111', weierp: '\u2118',
  real: '\u211c', alefsym: '\u2135', larr: '\u2190', uarr: '\u2191',
  rarr: '\u2192', darr: '\u2193', harr: '\u2194', crarr: '\u21b5',
  lArr: '\u21d0', uArr: '\u21d1', rArr: '\u21d2', dArr: '\u21d3',
  hArr: '\u21d4', forall: '\u2200', part: '\u2202', exist: '\u2203',
  empty: '\u2205', nabla: '\u2207', isin: '\u2208', notin: '\u2209',
  ni: '\u220b', prod: '\u220f', sum: '\u2211', minus: '\u2212',
  lowast: '\u2217', radic: '\u221a', prop: '\u221d', infin: '\u221e',
  ang: '\u2220', and: '\u2227', or: '\u2228', cap: '\u2229',
  cup: '\u222a', int: '\u222b', there4: '\u2234', sim: '\u223c',
  cong: '\u2245', asymp: '\u2248', ne: '\u2260', equiv: '\u2261',
  le: '\u2264', ge: '\u2265', sub: '\u2282', sup: '\u2283',
  nsub: '\u2284', sube: '\u2286', supe: '\u2287', oplus: '\u2295',
  otimes: '\u2297', perp: '\u22a5', sdot: '\u22c5', lceil: '\u2308',
  rceil: '\u2309', lfloor: '\u230a', rfloor: '\u230b', lang: '\u2329',
  rang: '\u232a', loz: '\u25ca', spades: '\u2660', clubs: '\u2663',
  hearts: '\u2665', diams: '\u2666', Alpha: '\u0391', Beta: '\u0392',
  Gamma: '\u0393', Delta: '\u0394', Epsilon: '\u0395', Zeta: '\u0396',
  Eta: '\u0397', Theta: '\u0398', Iota: '\u0399', Kappa: '\u039a',
  Lambda: '\u039b', Mu: '\u039c', Nu: '\u039d', Xi: '\u039e',
  Omicron: '\u039f', Pi: '\u03a0', Rho: '\u03a1', Sigma: '\u03a3',
  Tau: '\u03a4', Upsilon: '\u03a5', Phi: '\u03a6', Chi: '\u03a7',
  Psi: '\u03a8', Omega: '\u03a9', alpha: '\u03b1', beta: '\u03b2',
  gamma: '\u03b3', delta: '\u03b4', epsilon: '\u03b5', zeta: '\u03b6',
  eta: '\u03b7', theta: '\u03b8', iota: '\u03b9', kappa: '\u03ba',
  lambda: '\u03bb', mu: '\u03bc', nu: '\u03bd', xi: '\u03be',
  omicron: '\u03bf', pi: '\u03c0', rho: '\u03c1', sigmaf: '\u03c2',
  sigma: '\u03c3', tau: '\u03c4', upsilon: '\u03c5', phi: '\u03c6',
  chi: '\u03c7', psi: '\u03c8', omega: '\u03c9', thetasym: '\u03d1',
  upsih: '\u03d2', piv: '\u03d6', Tab: '\t', NewLine: '\n',
  colon: ':', semi: ';', sol: '/', bsol: '\\', lpar: '(', rpar: ')',
  comma: ',', period: '.', quest: '?', excl: '!', dollar: '$',
  commat: '@', num: '#', percnt: '%', plus: '+', equals: '=',
  ast: '*', Hat: '^', lowbar: '_', grave: '`', lcub: '{', rcub: '}',
  lsqb: '[', rsqb: ']', verbar: '|', hellip: '\u2026', prime: '\u2032',
  Prime: '\u2033',oline2: '\u203e', trade: '\u2122', bull: '\u2022',
  check: '\u2713', cross: '\u2717', star: '\u2605', hearts2: '\u2665',
  copy2: '\u00a9', shy2: '\u00ad',
};

const PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/;
const WS_RE = /\s/;
const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;

function isPunct(ch) {
  return ch !== '' && (PUNCT_RE.test(ch) || UNICODE_PUNCT_RE.test(ch));
}
function isSpace(ch) {
  return ch !== '' && WS_RE.test(ch);
}

// Escape text for HTML output, the way marked does: &, <, >, " and '.
// (For code spans and code blocks marked escapes every &, see escStrict.)
function esc(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') out += '&amp;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else if (c === "'") out += '&#39;';
    else out += c;
  }
  return out;
}

// Marked's escape for ordinary text, link titles, hrefs and alt text: an
// '&' that starts something shaped like a named entity reference (&word;)
// is left alone, every other & is escaped. Numeric references never reach
// here (valid ones are decoded while tokenising, invalid ones start with
// '&#', so their & is escaped).
function escText(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) j++;
      if (j > i + 1 && s[j] === ';') { out += '&'; continue; }
      out += '&amp;';
    }
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else if (c === "'") out += '&#39;';
    else out += c;
  }
  return out;
}

// Decode one NUMERIC character reference starting at s[i] ('&'). Marked
// decodes numeric references in text but leaves named ones verbatim (they
// survive as &name; in the output). Returns [decodedChar, length] or null.
function decodeEntityAt(s, i) {
  if (s[i] !== '&' || s[i + 1] !== '#') return null;
  let j = i + 2;
  let hex = false;
  if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
  const start = j;
  while (j < s.length && (hex ? /[0-9a-fA-F]/.test(s[j]) : /[0-9]/.test(s[j]))) j++;
  if (j === start || s[j] !== ';') return null;
  const n = parseInt(s.slice(start, j), hex ? 16 : 10);
  if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) {
    if (n === 0) return ['\ufffd', j + 1 - i];
    return null;
  }
  return [String.fromCodePoint(n), j + 1 - i];
}

// Decode every reference in s (named via the table, numeric when valid).
// Used only to test a link destination's protocol; the destination itself
// is never rewritten this way.
function decodeEntitiesFull(s) {
  if (s.indexOf('&') === -1) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '&') {
      const d = decodeEntityAt(s, i);
      if (d) { out += d[0]; i += d[1]; continue; }
      let k = i + 1;
      while (k < s.length && /[A-Za-z0-9]/.test(s[k])) k++;
      if (s[k] === ';' && k > i + 1) {
        const v = ENTITIES[s.slice(i + 1, k)];
        if (v !== undefined) { out += v; i = k + 1; continue; }
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

// Remove backslash escapes before ASCII punctuation.
function unescapeBackslash(s) {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g, '$1');
}

// Decode every character reference in s.
function decodeEntities(s) {
  return decodeEntitiesFull(s);
}

// Normalise a link label: trim, collapse inner whitespace to one space,
// case-fold. (Link reference definitions are keyed by this.)
function normalizeLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/ß/g, 'ss').replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    .replace(/ﬅ/g, 'st').replace(/ﬆ/g, 'st').replace(/ſ/g, 's');
}

// Clean a link destination for use as href. Returns null for a destination
// whose protocol is disallowed (javascript:, vbscript:, data:). The check
// runs on an entity-decoded copy, so &colon; and numeric tricks do not hide
// the protocol; the destination itself is returned unchanged. A bare '%'
// in the destination (e.g. '98%') is not a valid escape, so it is first
// rewritten to '%25': decodeURIComponent would throw on it and wrongly
// drop the whole link (doc-01).
function cleanHref(href) {
  let prot = '';
  try {
    const safe = decodeEntitiesFull(href).replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
    prot = decodeURIComponent(safe).replace(/[^\w:]/g, '').toLowerCase();
  } catch {
    return null;
  }
  if (prot.indexOf('javascript:') === 0 ||
      prot.indexOf('vbscript:') === 0 ||
      prot.indexOf('data:') === 0) return null;
  return href;
}

// Encode a destination the way a browser address would be written: spaces
// and non-ASCII become percent escapes, already-escaped sequences survive.
// A bare '%' in the source is encoded to '%25' by encodeURI; marked
// reverts every '%25' back to '%', so '98%' stays '98%' in the href.
function encodeDest(dest) {
  try { return encodeURI(dest).replace(/%25/g, '%'); }
  catch { return dest; }
}

// Match an HTML tag, comment, processing instruction, declaration or CDATA
// section starting at s[i] ('<'). Returns {end, name, closing} where end is
// the index just past the construct, name the lower-cased tag name ('' for
// comments and friends), closing true for </...>; or null when s[i] does
// not start a valid construct.
function matchTag(s, i) {
  if (s[i] !== '<') return null;
  const n = s.length;
  if (s[i + 1] === '!') {
    if (s.startsWith('<!--', i)) {
      // <!--> and <!---> are complete comments by themselves (cm-626):
      // they end at their own '>', not at a later '-->'.
      if (s.startsWith('<!-->', i)) return { end: i + 5, name: '', closing: false };
      if (s.startsWith('<!--->', i)) return { end: i + 6, name: '', closing: false };
      const e = s.indexOf('-->', i + 4);
      if (e === -1) return null;
      return { end: e + 3, name: '', closing: false };
    }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      if (e === -1) return null;
      return { end: e + 3, name: '', closing: false };
    }
    // Declaration: <! followed by an ASCII letter, up to the next '>'.
    if (/[A-Za-z]/.test(s[i + 2] || '')) {
      const e = s.indexOf('>', i + 2);
      if (e === -1) return null;
      return { end: e + 1, name: '', closing: false };
    }
    return null;
  }
  if (s[i + 1] === '?') {
    const e = s.indexOf('?>', i + 2);
    if (e === -1) return null;
    return { end: e + 2, name: '', closing: false };
  }
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (!/[A-Za-z]/.test(s[j] || '')) return null;
  const nameStart = j;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  const name = s.slice(nameStart, j).toLowerCase();
  if (closing) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (s[j] !== '>') return null;
    return { end: j + 1, name, closing: true };
  }
  // Open tag: attributes, then an optional '/' and '>'. After the tag
  // name, and after each attribute, only whitespace, '>' or '/' may
  // follow: an attribute needs preceding whitespace, so '<m:abc>' and
  // "<a href='bar'title=title>" are not tags (cm-609, cm-622).
  for (;;) {
    let ws = 0;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) { j++; ws++; }
    if (j >= n) return null;
    if (s[j] === '>') return { end: j + 1, name, closing: false };
    if (s[j] === '/') {
      if (s[j + 1] === '>') return { end: j + 2, name, closing: false };
      return null;
    }
    if (ws === 0) return null;
    if (!/[A-Za-z_:]/.test(s[j])) return null;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    // Optional '= value', with whitespace allowed around '='. Only
    // consume the whitespace when '=' actually follows: after a bare
    // attribute name ('<a foo bar>') the space is the separator before
    // the next attribute, and the loop-top check still needs to see it.
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
    if (s[k] === '=') {
      j = k + 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        if (j >= n || /[\s"'=<>`]/.test(s[j])) return null;
        while (j < n && !/[\s"'=<>`]/.test(s[j])) j++;
      }
    }
  }
}

// Split a table row line into cells, honouring backslash-escaped pipes and
// pipes inside code spans. Leading and trailing pipes are dropped.
function splitCells(line) {
  const cells = [];
  let cur = '';
  let i = 0;
  let inCode = false;
  let codeLen = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '`') {
      let j = i;
      while (j < line.length && line[j] === '`') j++;
      const run = j - i;
      if (inCode) {
        // A run closes the span exactly when no later run of the
        // opener's length appears before the next '|' ('``add`' closes
        // at the single backtick, doc-18; '`` a ` b ``' does not close
        // at the inner single backtick because the final '``' follows,
        // doc-21/39; '`a ` b`' does not close at the middle backtick,
        // doc-21/39; '`a | b`' keeps its inner '|' because no run
        // precedes it, doc-18).
        let k = j;
        let later = false;
        while (k < line.length && line[k] !== '|') {
          if (line[k] === '`') {
            let m = k;
            while (m < line.length && line[m] === '`') m++;
            if (m - k === codeLen) { later = true; break; }
            k = m;
          } else k++;
        }
        if (!later) { inCode = false; codeLen = 0; }
      } else { inCode = true; codeLen = run; }
      cur += line.slice(i, j);
      i = j;
      continue;
    }
    if (c === '\\' && i + 1 < line.length) {
      // An escaped pipe is a literal '|' in the cell (gfm-200): unescape
      // it here, so a code span holding it renders '|' and not '\|'.
      // Any other escape keeps both characters for the inline parser.
      if (line[i + 1] === '|') { cur += '|'; i += 2; continue; }
      cur += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '|' && !inCode) {
      cells.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  cells.push(cur);
  // Drop a leading empty cell when the line starts with a pipe, and a
  // trailing one when it ends with an unescaped pipe.
  let start = 0;
  let end = cells.length;
  if (cells.length > 0 && line.trimStart().startsWith('|')) start = 1;
  if (end > start && line.trimEnd().endsWith('|') &&
      !line.trimEnd().endsWith('\\|')) end -= 1;
  const out = [];
  for (let k = start; k < end; k++) out.push(cells[k].trim());
  return out;
}

// ---- Inline parsing ------------------------------------------------------
// Nodes: {t:'text',s} {t:'code',s} {t:'html',s} {t:'br'}
//        {t:'delim',ch,len,canOpen,canClose}
//        {t:'link'|'image',href,title,children} {t:'em'|'strong'|'del',children}

function plainText(nodes) {
  let out = '';
  for (const nd of nodes) {
    if (nd.t === 'text' || nd.t === 'code' || nd.t === 'html') out += nd.s;
    else if (nd.t === 'delim') out += nd.ch.repeat(nd.len);
    else if (nd.t === 'br') out += '\n';
    else if (nd.children) out += plainText(nd.children);
  }
  return out;
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/;

// Scan an extended-autolink path after the domain. The path runs to
// whitespace or '<'. A ']' ends it while inside a bracket that can still
// form a link (doc-12/24: the ']' must survive to close the link text);
// in a doomed bracket the ']' is path text (doc-08
// 'https://sub.domain.example.io)]' links whole). A '(' is path text
// while parens are balanced, but once an unmatched ')' has driven the
// depth negative a '(' ends the path (doc-08: the '(' after ')]' does
// not belong to the link). Balanced parens inside a path stay
// ('http://www.google.com/search?q=Markup+(business)', gfm-625).
function scanAutoPath(rest, start, inLink) {
  let depth = 0;
  let p = start;
  while (p < rest.length) {
    const ch = rest[p];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '<') break;
    if (ch === ']' && inLink) break;
    if (ch === '(' && depth < 0) break;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    p++;
  }
  return p;
}

// Can the innermost open bracket still form a link or image? It cannot
// once its text already holds a bracket-formed link (an '<...>' autolink
// does not block it); an image opener can always form, links inside its
// alt text being allowed. Used to decide whether an extended autolink's
// path may swallow the ']' that would close the bracket.
function topBracketFormable(nodes, stack) {
  if (!stack.length) return false;
  const opener = stack[stack.length - 1];
  if (opener.isImage) return true;
  const opIdx = nodes.indexOf(opener.node);
  if (opIdx === -1) return false;
  for (let k = opIdx + 1; k < nodes.length; k++) {
    if (nodes[k].t === 'link' && !nodes[k].auto) return false;
  }
  return true;
}

// Try to match an extended autolink (www. / http(s):// / scheme:email /
// email) at s[i]. Returns {end, href, text} or null. `prev` is the
// character before i; `inLink` is true while the innermost open bracket
// can still form a link or image (see topBracketFormable).
function matchExtendedAutolink(s, i, prev, inLink) {
  const rest = s.slice(i);
  let text = null;
  let href = null;
  let kind = '';
  if (rest.startsWith('www.')) {
    if (prev && /[A-Za-z0-9]/.test(prev)) return null;
    // The path may start with '/', '?', '#' or '\' (a query or a
    // backslash straight after the domain still belongs to the link:
    // 'https://npmjs.com?q=...' doc-14, 'www.flux.com\' doc-40).
    const dm = /^(www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\:[0-9]+)?)/.exec(rest);
    if (!dm) return null;
    text = rest.slice(0, scanAutoPath(rest, dm[0].length, inLink));
    kind = 'www';
  } else if (/^https?:\/\//i.test(rest)) {
    // The scheme is case-insensitive ('Https://www.example.com/...'
    // links whole, doc-06); the matched text keeps its original case.
    if (prev && /[A-Za-z0-9]/.test(prev)) return null;
    const dm = /^((?:https?:\/\/)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\:[0-9]+)?)/i.exec(rest);
    if (!dm) return null;
    text = rest.slice(0, scanAutoPath(rest, dm[0].length, inLink));
    kind = 'http';
  } else if (/[A-Za-z]/.test(rest[0] || '')) {
    // Scheme autolink: scheme ':' email, plus one optional path segment
    // ('mailto:foo@bar.baz', 'xmpp:foo@bar.baz/txt'; '/txt/bin' leaves
    // '/bin' literal, gfm-633/634/635).
    const sm = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):/.exec(rest);
    if (sm && !(prev && /[A-Za-z0-9._%+-]/.test(prev))) {
      const em = EMAIL_RE.exec(rest.slice(sm[0].length));
      if (em) {
        text = sm[0] + em[0];
        const pm = inLink ? /^\/[^\/\s<\]]+/.exec(rest.slice(text.length))
          : /^\/[^\/\s<]+/.exec(rest.slice(text.length));
        if (pm) text += pm[0];
        kind = 'scheme';
      }
    }
    if (text === null) {
      if (prev && /[A-Za-z0-9._%+-]/.test(prev)) return null;
      const m = EMAIL_RE.exec(rest);
      if (!m) return null;
      text = m[0];
      kind = 'email';
    }
  } else {
    if (prev && /[A-Za-z0-9._%+-]/.test(prev)) return null;
    const m = EMAIL_RE.exec(rest);
    if (!m) return null;
    text = m[0];
    kind = 'email';
  }
  // Trim trailing punctuation the way GFM does: ? ! . , : * _ ~, an
  // unbalanced closing paren, and a trailing ';' — either the whole
  // '&...;' entity-like tail when one is present (gfm-627:
  // 'www.google.com/search?q=commonmark&hl;' links without '&hl;') or
  // just the ';' itself (doc-02 '...&page=9;' links without ';',
  // doc-27 '...page=2.;' without '.;', doc-28 '.../call;' without ';',
  // and bare emails 'one@prism.example.com;' the same).
  let changed = true;
  while (changed) {
    changed = false;
    if (text.endsWith(';')) {
      const amp = text.lastIndexOf('&');
      if (amp !== -1 && /^[A-Za-z0-9]+$/.test(text.slice(amp + 1, -1))) {
        text = text.slice(0, amp);
      } else {
        text = text.slice(0, -1);
      }
      changed = true;
    } else if (/[?!.,:*_~]$/.test(text)) {
      text = text.slice(0, -1);
      changed = true;
    } else if (text.endsWith(')')) {
      const opens = (text.match(/\(/g) || []).length;
      const closes = (text.match(/\)/g) || []).length;
      if (closes > opens) { text = text.slice(0, -1); changed = true; }
    }
  }
  if (!text) return null;
  // A bare email (or a scheme autolink) followed by '-' or '_' does not
  // form an autolink at all (gfm-632, gfm-633). This does not apply to
  // www/http autolinks ('https://sub.domain.example.io__' still links,
  // doc-02).
  if ((kind === 'email' || kind === 'scheme')) {
    const afterCh = s[i + text.length];
    if (afterCh === '-' || afterCh === '_') return null;
  }
  if (kind === 'www') href = 'http://' + text;
  else if (kind === 'http') href = text;
  else if (kind === 'email') href = 'mailto:' + text;
  else href = text;
  // The href is built from the backslash-unescaped text, then encoded:
  // 'www.flux.com\\' (two backslashes in the link text) yields href
  // 'http://www.flux.com%5C' (one encoded backslash, doc-40).
  href = cleanHref(encodeDest(unescapeBackslash(href)));
  if (href === null) return null;
  return { end: i + text.length, href, text };
}

// Parse a link destination + optional title starting at s[i] ('(').
// Returns {href, title, end} (end just past ')') or null.
function parseInlineLink(s, i) {
  const n = s.length;
  if (s[i] !== '(') return null;
  let j = i + 1;
  // Skip whitespace, newlines included (up to a few, per the spec's
  // "one or more spaces, tabs or line endings" allowance).
  let skipped = 0;
  while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) { j++; skipped++; }
  if (skipped > 3 && false) return null;
  if (j >= n) return null;
  let dest = '';
  if (s[j] === '<') {
    let e = j + 1;
    let found = -1;
    while (e < n) {
      if (s[e] === '\\' && e + 1 < n) { e += 2; continue; }
      if (s[e] === '>') { found = e; break; }
      e++;
    }
    if (found === -1) return null;
    const inner = s.slice(j + 1, found);
    let hasLt = false;
    for (let q = 0; q < inner.length; q++) {
      if (inner[q] === '\\') { q++; continue; }
      if (inner[q] === '<') { hasLt = true; break; }
    }
    if (hasLt || inner.indexOf('\n') !== -1) return null;
    dest = inner;
    j = found + 1;
  } else {
    let depth = 0;
    const start = j;
    while (j < n) {
      const c = s[j];
      if (c === ' ' || c === '\t' || c === '\n') break;
      if (c === '\\' && j + 1 < n && PUNCT_RE.test(s[j + 1])) { j += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (j === start && s[j] !== ')') return null;
    dest = s.slice(start, j);
    // A bare destination may not contain an unescaped '(' unless balanced;
    // the scan above already enforces balance by stopping at the unmatched ')'.
  }
  // Optional title, after whitespace.
  let title = null;
  let k = j;
  while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  if (k < n && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
    const open = s[k];
    const close = open === '(' ? ')' : open;
    let p = k + 1;
    let ok = false;
    let titleText = '';
    while (p < n) {
      const c = s[p];
      if (c === '\\' && p + 1 < n && PUNCT_RE.test(s[p + 1])) { titleText += s[p + 1]; p += 2; continue; }
      if (c === close) { ok = true; break; }
      if (open === '(' && c === '(') break;
      titleText += c;
      p++;
    }
    if (!ok) return null;
    title = titleText;
    k = p + 1;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
  }
  if (s[k] !== ')') return null;
  return { href: dest, title, end: k + 1 };
}

// Scan a link label starting at s[i] ('['). Returns {label, end} with end
// just past the closing ']', or null. A label containing an unescaped '['
// is invalid (cm-546: '[foo][ref[]' forms no reference).
function parseLabel(s, i) {
  if (s[i] !== '[') return null;
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { j += 2; continue; }
    if (c === '[') return null;
    if (c === ']') return { label: s.slice(i + 1, j), end: j + 1 };
    j++;
  }
  return null;
}

// Try to resolve the bracket closed by s[i] (']'). `nodes` is the node list
// built so far, `stack` the open brackets. Returns the index to continue
// scanning from, or null when no link forms (']' is literal text). A failed
// closer removes only its own bracket from the stack, so a later ']' can
// still pair an outer '[' with the last ']' ([link [foo [bar]]], cm-512).
// Shortcut keys use the RAW source text between '[' and ']' (cm-194,
// cm-550): the definition label is raw ('Foo*bar\]'), not escape-processed.
// A failed full reference '[foo][bar]' does NOT fall back to the shortcut
// '[foo]' (cm-571); a failed inline destination still falls back to the
// shortcut for the bracket's own text (cm-568).
function tryCloseBracket(s, i, nodes, stack, refs) {
  if (stack.length === 0) return null;
  const opener = stack[stack.length - 1];
  const opIdx = nodes.indexOf(opener.node);
  if (opIdx === -1) { stack.pop(); return null; }
  const children = nodes.slice(opIdx + 1);
  const rawLabel = s.slice(opener.pos + 1, i);
  let href = null;
  let title = null;
  let end = -1;
  const after = i + 1;
  const fail = () => {
    stack.pop();
    return null;
  };
  // A link does not form when its text contains a code span whose
  // content holds a backtick AND (a) the link is a reference link
  // ('[empty test `` a ` b `` output][all-40]' stays literal, doc-18),
  // or (b) the text also holds an emphasis delimiter, i.e. the span
  // sits inside an emphasis pair ('[but _previous from `` a ` b ``_]'
  // stays literal, doc-20). A bare inner-backtick code span in an
  // INLINE link does not block ('[issues files `` a ` b ``](...)'
  // forms, doc-03/05/09/10/16), nor does a code span without an inner
  // backtick ('[by ` it ` request][all-40]' forms, doc-18).
  const isInline = s[after] === '(';
  let hasCode = false;
  let hasDelim = false;
  let lastCode = -1;
  for (let ci = 0; ci < children.length; ci++) {
    const nd = children[ci];
    if (nd.t === 'code' && nd.s.indexOf('`') !== -1) { hasCode = true; lastCode = ci; }
    if (nd.t === 'delim') hasDelim = true;
  }
  // A reference link is blocked by an inner-backtick code span only
  // when a node follows the span ('[empty test `` a ` b ``
  // output][all-40]' stays literal, doc-18); when the span is the
  // last thing in the text ('[for table `` a ` b ``][29]') it forms
  // (doc-10). An inline link is blocked only when the text also
  // holds an emphasis delimiter ('[but _previous from `` a ` b ``_]'
  // stays literal, doc-20); a bare span in an inline link does not
  // block ('[issues files `` a ` b ``](...)' forms, doc-03/05/09/
  // 10/16), nor does a code span without an inner backtick ('[by
  // ` it ` request][all-40]' forms, doc-18).
  const blocked = hasCode &&
    (isInline ? hasDelim : lastCode < children.length - 1);
  if (blocked) {
    // The emphasis delimiters inside this failed link text do not form
    // either: '[but _previous from `` a ` b ``_](...)' leaves the '_'
    // literal (doc-20). Disable them so processEmphasis skips the pair.
    // (In a plain paragraph the same '_..._' DOES form, doc-24.)
    for (const nd of children) {
      if (nd.t === 'delim') { nd.canOpen = false; nd.canClose = false; }
    }
    return fail();
  }
  if (s[after] === '(') {
    const parsed = parseInlineLink(s, after);
    if (parsed) {
      href = parsed.href;
      title = parsed.title;
      end = parsed.end;
    } else {
      const key = normalizeLabel(rawLabel);
      const ref = key === '' ? null : refs[key];
      if (!ref) return fail();
      href = ref.dest;
      title = ref.title;
      end = after;
    }
  } else if (s[after] === '[') {
    const lab = parseLabel(s, after);
    if (!lab) return fail();
    const key = lab.label === '' ? normalizeLabel(rawLabel) : normalizeLabel(lab.label);
    const ref = refs[key];
    if (!ref) return fail();
    href = ref.dest;
    title = ref.title;
    end = lab.end;
  } else {
    const key = normalizeLabel(rawLabel);
    const ref = key === '' ? null : refs[key];
    if (!ref) return fail();
    href = ref.dest;
    title = ref.title;
    end = after;
  }
  // A link's text may not itself contain a link formed by brackets (an
  // image's may). An '<...>' autolink inside the text DOES nest (marked
  // renders it: doc-09 '[close some are <mailto:to@docs.example.dev>]'
  // keeps the nested '<a>'), but a bare extended autolink (www/http/
  // email) does NOT form inside link text — it stays plain text
  // (doc-04 '[it write@glyph.example.com][every-16]', doc-09
  // '[examples remove this https://www.example.com/at. stable](...)',
  // doc-10/15/16/36/39). Extended autolinks are therefore converted
  // back to text when the outer link closes; a failed closer leaves
  // them as links, as they were tokenised before the ']' was seen.
  if (!opener.isImage) {
    for (const nd of children) if (nd.t === 'link' && !nd.auto) { stack.pop(); return null; }
  }
  for (let ci = 0; ci < children.length; ci++) {
    const nd = children[ci];
    if (nd.t === 'link' && nd.ext) {
      const txt = nd.children.map((c) => (c.t === 'text' ? c.s : '')).join('');
      children[ci] = { t: 'text', s: txt };
    }
  }
  const decoded = unescapeBackslash(href);
  const cleaned = cleanHref(encodeDest(decoded));
  const node = opener.isImage
    ? { t: 'image', href: cleaned, title, children }
    : { t: 'link', href: cleaned, title, children };
  nodes.splice(opIdx, nodes.length - opIdx, node);
  // Drop every opener that now lives inside the new node.
  for (let k = stack.length - 1; k >= 0; k--) {
    if (nodes.indexOf(stack[k].node) === -1) stack.splice(k, 1);
  }
  return end;
}

// Tokenise one inline string into a node list (emphasis not yet resolved).
function tokenizeInline(s, refs) {
  const nodes = [];
  const stack = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') { nodes.push({ t: 'text', s: buf }); buf = ''; }
  };
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    // Backslash escape, or a hard break before a line ending. An escaped
    // '&' is written out already-escaped, so it can never start an entity
    // reference of its own (marked renders \&ouml; as &amp;ouml;). A hard
    // break also eats the next line's leading whitespace.
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') {
        flush();
        nodes.push({ t: 'br' });
        i += 2;
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
        continue;
      }
      if (nx !== undefined && PUNCT_RE.test(nx)) {
        buf += nx === '&' ? '&amp;' : nx;
        i += 2;
        continue;
      }
      buf += c; i++; continue;
    }
    // Line ending: hard break after two spaces, soft break otherwise. A
    // hard break eats the next line's leading whitespace.
    if (c === '\n') {
      if (i >= 2 && s[i - 1] === ' ' && s[i - 2] === ' ') {
        buf = buf.replace(/ +$/, '');
        flush();
        nodes.push({ t: 'br' });
        i++;
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
      } else {
        buf += '\n';
        i++;
      }
      continue;
    }
    // Code span.
    if (c === '`') {
      let j = i;
      while (j < n && s[j] === '`') j++;
      const run = j - i;
      // Find a closing run of exactly this length. Inside link text
      // (an open bracket) the closer is the LAST run of this length
      // before the closing ']': '`a ` b`' is one span with content
      // 'a ` b' (doc-03/05/09/10/16), and '`` a ` b ``' is one span
      // with content 'a ` b' (doc-18/20). In plain text the closer is
      // the FIRST run of this length (cm-328 '`foo` bar `baz`').
      let k = j;
      let close = -1;
      if (stack.length > 0) {
        const brk = s.indexOf(']', j);
        const lim = brk === -1 ? n : brk;
        let kk = j;
        while (kk < lim) {
          if (s[kk] === '`') {
            let m = kk;
            while (m < lim && s[m] === '`') m++;
            if (m - kk === run) close = kk;
            kk = m;
          } else kk++;
        }
      }
      if (close === -1) {
        if (stack.length > 0) {
          // Inside link text, a span whose closer is not before the
          // ']' does not form: '``url`' and '``guide`' stay literal
          // (doc-09/16) — unless the span SPANS the ']' (the closer
          // is the very next backtick run after it, same length:
          // '[not a `link](/foo`)' cm-342, '[foo`](/uri)`' cm-525,
          // '[foo`][ref]`' cm-537). Do not fall through to a later
          // run in the string, which would swallow the rest of the
          // line.
          const brk = s.indexOf(']', j);
          if (brk !== -1) {
            // Only the FIRST backtick run inside the bracket may span
            // the ']' (cm-342/525/537). A later run is literal: in
            // '[values ``guide` in](#should)' the single backtick
            // after 'guide' must not open a span to the backtick
            // before 'deno' (doc-16).
            const bpos = stack[stack.length - 1].pos;
            let firstRun = true;
            for (let q = bpos + 1; q < i; q++) {
              if (s[q] === '`') { firstRun = false; break; }
            }
            if (firstRun) {
              let m = brk + 1;
              while (m < n && s[m] !== '`') m++;
              if (m < n) {
                let e = m;
                while (e < n && s[e] === '`') e++;
                if (e - m === run) close = m;
              }
            }
          }
          if (close === -1) {
            buf += s.slice(i, j);
            i = j;
            continue;
          }
        } else {
          while (k < n) {
            if (s[k] === '`') {
              let m = k;
              while (m < n && s[m] === '`') m++;
              if (m - k === run) { close = k; break; }
              k = m;
            } else k++;
          }
        }
      }
      if (close !== -1) {
        let content = s.slice(j, close).replace(/\n/g, ' ');
        if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') &&
            !/^ +$/.test(content)) content = content.slice(1, -1);
        flush();
        nodes.push({ t: 'code', s: content, len: run });
        i = close + run;
        continue;
      }
      buf += s.slice(i, j);
      i = j;
      continue;
    }
    // '<': autolink or raw HTML.
    if (c === '<') {
      const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/.exec(s.slice(i, i + 512)) ||
        /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(s.slice(i, i + 512));
      if (auto) {
        flush();
        const raw = auto[1];
        const isMail = raw.indexOf(':') === -1;
        const href = isMail ? 'mailto:' + raw : raw;
        const cleaned = cleanHref(encodeDest(raw));
        if (cleaned === null) {
          nodes.push({ t: 'text', s: raw });
        } else {
          nodes.push({ t: 'link', href: isMail ? 'mailto:' + raw : cleaned, title: null,
            auto: true, children: [{ t: 'text', s: raw }] });
        }
        i += auto[0].length;
        continue;
      }
      const tag = matchTag(s, i);
      if (tag) {
        flush();
        // Marked renders every matched tag as raw HTML: there is no
        // disallowed-tag escaping (gfm-657 renders <title>, <style> and
        // <xmp> verbatim).
        nodes.push({ t: 'html', s: s.slice(i, tag.end) });
        i = tag.end;
        continue;
      }
      buf += '<';
      i++;
      continue;
    }
    // Image / link opener. The stack entry keeps the source position of
    // the '[' so a shortcut reference can key on the RAW label text
    // between '[' and ']' (cm-194, cm-550), not the escape-processed
    // rendering of the link text.
    if (c === '!' && s[i + 1] === '[') {
      flush();
      const node = { t: 'text', s: '![' };
      nodes.push(node);
      stack.push({ node, isImage: true, pos: i + 1 });
      i += 2;
      continue;
    }
    if (c === '[') {
      flush();
      const node = { t: 'text', s: '[' };
      nodes.push(node);
      stack.push({ node, isImage: false, pos: i });
      i++;
      continue;
    }
    // Closing bracket: try to form a link or image.
    if (c === ']') {
      flush();
      const end = tryCloseBracket(s, i, nodes, stack, refs);
      if (end !== null) { i = end; continue; }
      buf += ']';
      i++;
      continue;
    }
    // Emphasis / strikethrough delimiter runs.
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && s[j] === c) j++;
      let run = j - i;
      const prev = i === 0 ? '' : s[i - 1];
      const next = j >= n ? '' : s[j];
      const prevWS = prev === '' || isSpace(prev);
      const nextWS = next === '' || isSpace(next);
      const prevP = prev !== '' && isPunct(prev);
      const nextP = next !== '' && isPunct(next);
      const leftFlank = !nextWS && (!nextP || prevWS || prevP);
      const rightFlank = !prevWS && (!prevP || nextWS || nextP);
      flush();
      if (c === '~') {
        // Tilde runs of length 1 or 2 are strikethrough delimiters
        // (gfm-491: '~there~' strikes); runs of 3 or more are literal
        // text (gfm-493: '~~~not~~~' does not strike).
        if (run <= 2) {
          nodes.push({ t: 'delim', ch: '~', len: run, canOpen: leftFlank, canClose: rightFlank });
        } else {
          nodes.push({ t: 'text', s: '~'.repeat(run) });
        }
      } else {
        let canOpen, canClose;
        if (c === '*') { canOpen = leftFlank; canClose = rightFlank; }
        else {
          canOpen = leftFlank && (!rightFlank || prevP);
          canClose = rightFlank && (!leftFlank || nextP);
        }
        nodes.push({ t: 'delim', ch: c, len: run, canOpen, canClose });
      }
      i = j;
      continue;
    }
    // Extended autolink: www. / http(s):// at this position, or an email
    // address starting here (only attempted when an '@' is close ahead).
    // The http(s) scheme is case-insensitive ('Https://...', doc-06).
    if ((c === 'w' && s.startsWith('www.', i)) ||
        ((c === 'h' || c === 'H') && /^https?:\/\//i.test(s.slice(i, i + 8)))) {
      const auto = matchExtendedAutolink(s, i, i === 0 ? '' : s[i - 1],
        topBracketFormable(nodes, stack));
      if (auto) {
        flush();
        nodes.push({ t: 'link', href: auto.href, title: null, auto: true, ext: true,
          children: [{ t: 'text', s: auto.text }] });
        i = auto.end;
        continue;
      }
    } else if (/[A-Za-z0-9]/.test(c)) {
      const at = s.indexOf('@', i);
      if (at !== -1 && at - i <= 64) {
        // matchExtendedAutolink tries a scheme autolink ('mailto:',
        // 'xmpp:') before the bare email, so no local-part gate here:
        // 'mailto:foo' contains ':' and would fail a local-part test.
        // The email regex itself still requires a valid local part.
        const auto = matchExtendedAutolink(s, i, i === 0 ? '' : s[i - 1],
          topBracketFormable(nodes, stack));
        if (auto) {
          flush();
          nodes.push({ t: 'link', href: auto.href, title: null, auto: true, ext: true,
            children: [{ t: 'text', s: auto.text }] });
          i = auto.end;
          continue;
        }
      }
    }
    // Entity reference: only numeric references decode in text; a decoded
    // '&' is already-escaped, as with a backslash escape.
    if (c === '&') {
      const d = decodeEntityAt(s, i);
      if (d) { buf += d[0] === '&' ? '&amp;' : d[0]; i += d[1]; continue; }
      buf += '&';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return nodes;
}

// Resolve emphasis and strikethrough in a node list, in place, following
// the CommonMark appendix algorithm (delimiter stack, rule of three).
// Does any node in list (or nested inside its children) hold a code
// span whose content contains a backtick, e.g. '`` a ` b ``'?
function hasInnerBacktickCode(list) {
  for (const nd of list) {
    if (nd.t === 'code' && nd.s.indexOf('`') !== -1) return true;
    if (nd.children && hasInnerBacktickCode(nd.children)) return true;
  }
  return false;
}

function processEmphasis(nodes) {
  const delims = [];
  for (const nd of nodes) if (nd.t === 'delim') delims.push(nd);
  if (delims.length === 0) return;
  // openers_bottom, keyed by delimiter character and closer length mod 3:
  // the lowest delimiter a future closer of that kind may still consider.
  // A closer that finds no opener becomes the bottom for its own slot.
  const bottom = new Map();
  let di = 0;
  while (di < delims.length) {
    const closer = delims[di];
    if (!closer.canClose) { di++; continue; }
    const ch = closer.ch;
    const key = ch + ':' + (closer.len % 3);
    const bot = bottom.get(key);
    // Scan backwards for an opener, considering the bottom delimiter
    // itself before stopping below it.
    let oi = di - 1;
    let opener = null;
    while (oi >= 0) {
      const cand = delims[oi];
      const isBot = cand === bot;
      if (cand.ch === ch && cand.canOpen) {
        // Rule of three: when either delimiter can both open and close,
        // a match is forbidden when the run lengths sum to a multiple of
        // 3 unless both lengths are multiples of 3.
        const both = (cand.canOpen && cand.canClose) ||
          (closer.canOpen && closer.canClose);
        const sum = cand.len + closer.len;
        if (!(both && sum % 3 === 0 && (cand.len % 3 !== 0 || closer.len % 3 !== 0))) {
          opener = cand;
          break;
        }
      }
      if (isBot) break;
      oi--;
    }
    if (!opener) {
      bottom.set(key, closer);
      di++;
      continue;
    }
    let use = 1;
    if (ch === '~') use = Math.min(2, opener.len, closer.len);
    else if (opener.len >= 2 && closer.len >= 2) use = 2;
    const opIdx = nodes.indexOf(opener);
    const clIdx = nodes.indexOf(closer);
    if (opIdx === -1 || clIdx === -1 || clIdx <= opIdx) { di++; continue; }
    const children = nodes.slice(opIdx + 1, clIdx);
    const type = ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
    const wrapped = { t: type, children };
    opener.len -= use;
    closer.len -= use;
    const replacement = [];
    if (opener.len > 0) replacement.push(opener);
    replacement.push(wrapped);
    if (closer.len > 0) replacement.push(closer);
    nodes.splice(opIdx, clIdx - opIdx + 1, ...replacement);
    for (let k = delims.length - 1; k >= 0; k--) {
      const d = delims[k];
      // A delimiter is spent when its run is used up, or when it now
      // lives inside a wrapped node (it stays literal text there).
      if (nodes.indexOf(d) === -1) {
        delims.splice(k, 1);
        if (k < di) di--;
      }
    }
    // A closer with length left is processed again for another opener;
    // a spent closer resumes at the next delimiter after the wrapped node.
    if (closer.len > 0) {
      di = delims.indexOf(closer);
    } else {
      const afterOpener = delims.findIndex((d) => nodes.indexOf(d) > nodes.indexOf(wrapped));
      di = afterOpener === -1 ? delims.length : afterOpener;
    }
  }
}

// Render one inline string to HTML. Emphasis is resolved in link and
// image children too: [*bar*](/url) keeps its emphasis inside the link,
// and an image's alt text drops matched emphasis markers (cm-419, cm-573).
function renderInline(s, refs) {
  if (s === '') return '';
  const nodes = tokenizeInline(s, refs);
  processEmphasisDeep(nodes);
  return renderNodes(nodes, refs);
}

function processEmphasisDeep(nodes) {
  processEmphasis(nodes);
  for (const nd of nodes) {
    // Recurse into every node with children, not just links and images:
    // emphasis can sit inside a link that is itself inside emphasis
    // ('*foo [*bar*](/url)*', cm-419/cm-433).
    if (nd.children) processEmphasisDeep(nd.children);
  }
}

function renderNodes(nodes, refs) {
  let out = '';
  for (const nd of nodes) {
    if (nd.t === 'text') out += escText(nd.s);
    else if (nd.t === 'code') out += '<code>' + esc(nd.s) + '</code>';
    else if (nd.t === 'html') out += nd.s;
    else if (nd.t === 'br') out += '<br>';
    else if (nd.t === 'delim') out += nd.ch.repeat(nd.len);
    else if (nd.t === 'em') out += '<em>' + renderNodes(nd.children, refs) + '</em>';
    else if (nd.t === 'strong') out += '<strong>' + renderNodes(nd.children, refs) + '</strong>';
    else if (nd.t === 'del') out += '<del>' + renderNodes(nd.children, refs) + '</del>';
    else if (nd.t === 'link') {
      if (nd.href === null) { out += renderNodes(nd.children, refs); continue; }
      out += '<a href="' + escText(nd.href) + '"';
      if (nd.title !== null) out += ' title="' + escText(nd.title) + '"';
      out += '>' + renderNodes(nd.children, refs) + '</a>';
    } else if (nd.t === 'image') {
      if (nd.href === null) { out += escText(plainText(nd.children)); continue; }
      out += '<img src="' + escText(nd.href) + '" alt="' + escText(plainText(nd.children)) + '"';
      if (nd.title !== null) out += ' title="' + escText(nd.title) + '"';
      out += '>';
    }
  }
  return out;
}

// ---- Block parsing -------------------------------------------------------
// Tokens: {t:'heading',level,inline} {t:'para',inline} {t:'code',text,lang}
//         {t:'hr'} {t:'html',text} {t:'quote',children} {t:'table',header,align,rows}
//         {t:'list',ordered,start,tight,items:[{task,checked,children}]}

function indentOf(line) {
  let col = 0;
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === '\t') col += 4 - (col % 4);
    else col++;
    i++;
  }
  return col;
}
// Remove up to n columns of leading WHITESPACE from a line. A tab that
// straddles the cut is removed ENTIRELY, leaving no remainder spaces:
// a top-level fenced line `\tindented` under a 3-space fence yields
// `indented` (doc-17), while a 2-space fence under a list item yields
// two spaces via the container dedent, not via this function (doc-14).
// Non-whitespace is never touched.
function dedentWs(line, n) {
  let col = 0;
  let i = 0;
  let out = '';
  while (i < line.length && col < n && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i++; }
      else { col = n; i++; }
    } else { col++; i++; }
  }
  return out + line.slice(i);
}
function isBlank(line) {
  return /^[ \t]*$/.test(line);
}
function isSetext(line) {
  const m = /^( {0,3})(=+|-+)[ \t]*$/.exec(line);
  return m ? (m[2][0] === '=' ? 1 : 2) : 0;
}
function isHr(line) {
  return /^( {0,3})((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(line);
}
function atxMatch(line) {
  const m = /^( {0,3})(#{1,6})(.*)$/.exec(line);
  if (!m) return null;
  const rest = m[3];
  if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return null;
  // The closing sequence is stripped from the rest including the separator
  // space, so `### ###` is empty while `# foo#` keeps its hash.
  const content = rest.replace(/[ \t]+$/, '').replace(/[ \t]+#+$/, '').replace(/^[ \t]+/, '');
  return { level: m[2].length, inline: content };
}
function fenceMatch(line) {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  if (m[2][0] === '`' && m[3].indexOf('`') !== -1) return null;
  return { indent: m[1].length, ch: m[2][0], len: m[2].length, info: m[3] };
}

// Does this line close a fence opened with `f.ch`/`f.len`? Same test as
// the fenced-code reader in parseBlockList.
function fenceClose(line, f) {
  const cm = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!cm && cm[2][0] === f.ch && cm[2].length >= f.len;
}

// Advance fence state for a line the child parser would see as a fresh
// block line (a pushed container line, never a lazy-appended continuation
// — that text is paragraph content in the child parse too). Returns the
// open fence, or null when no fence is open.
function fenceStep(line, f) {
  if (f) return fenceClose(line, f) ? null : f;
  const fm = fenceMatch(line);
  return fm ? { ch: fm.ch, len: fm.len } : null;
}

// HTML block start kinds. Types 1-6 may interrupt a paragraph; type 7 may not.
const HTML6_OPEN = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;
function htmlBlockStart(line) {
  const m = /^( {0,3})</.exec(line);
  if (!m) return 0;
  const rest = line.slice(m[1].length);
  if (/^<(script|pre|style|textarea)([\s>]|$)/i.test(rest)) return 1;
  if (rest.startsWith('<!--')) return 2;
  if (rest.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(rest)) return 4;
  if (rest.startsWith('<![CDATA[')) return 5;
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(rest);
  if (tag && HTML6_OPEN.test(tag[1]) &&
      /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s>\/]|$)/.test(rest)) return 6;
  // Type 7: a complete open or closing tag, alone on the line.
  const whole = matchTag(line, m[1].length);
  if (whole && whole.end === line.length) return 7;
  return 0;
}
function htmlBlockEndKind(kind, line) {
  switch (kind) {
    case 1: return /<\/(script|pre|style|textarea)>/i.test(line);
    case 2: return line.indexOf('-->') !== -1;
    case 3: return line.indexOf('?>') !== -1;
    case 4: return line.indexOf('>') !== -1;
    case 5: return line.indexOf(']]>') !== -1;
    default: return false;
  }
}

// Is this line a paragraph line (one that could continue a paragraph)?
// Blank lines, indented code, setext underlines and block starts are not;
// a nested blockquote counts when its own content is a paragraph line.
function isParaLine(line, inItem) {
  if (isBlank(line)) return false;
  if (indentOf(line) >= 4) return false;
  if (isSetext(line)) return false;
  const qs = quoteStart(line);
  if (qs !== -1) return isParaLine(expandLeadingTabs(line, qs), inItem);
  const lm = listMarker(line);
  if (lm) return isParaLine(lm.rest, inItem);
  if (interruptsPara(line, inItem)) return false;
  return true;
}

// Does this line start a block that can interrupt a paragraph?
// `inItem` is true while parsing list-item content: there an ordered
// list interrupts a paragraph whatever its start number is (doc-02
// `49.`, doc-04 `382900.`, doc-27 `0.` — all nested inside an item),
// while at the top level only a list starting at 1 interrupts
// (cm-304 `14.` stays paragraph text, cm-305 `1.` becomes a list).
function interruptsPara(line, inItem) {
  if (atxMatch(line)) return true;
  if (fenceMatch(line)) return true;
  if (isHr(line)) return true;
  if (quoteStart(line) !== -1) return true;
  const hb = htmlBlockStart(line);
  if (hb >= 1 && hb <= 6) return true;
  const lm = listMarker(line);
  if (lm) {
    // A list interrupts a paragraph only when its first item is
    // non-empty, and an ordered list only when it starts with 1 —
    // except inside list-item content, where any start number does.
    return !isBlank(lm.rest) && (!lm.ordered || lm.num === 1 || inItem);
  }
  return false;
}

// A bullet or ordered list marker at the start of the line.
// Returns {bullet, num, delim, markerLen, contentCol, ordered} or null.
function listMarker(line) {
  let m = /^( {0,3})([*+-])([ \t]+|$)/.exec(line);
  if (m) {
    const indent = m[1].length;
    // Column width of the separator run (a tab advances to the next
    // multiple of four from the marker's column).
    let col = indent + 1;
    for (let q = 0; q < m[3].length; q++) {
      col += m[3][q] === '\t' ? 4 - (col % 4) : 1;
    }
    const sepCols = col - indent - 1;
    // An empty marker line (nothing after the separator) takes its
    // content indent from the marker alone, however many spaces follow.
    const emptyLine = indent + 1 + m[3].length >= line.length;
    const contentCol = emptyLine ? indent + 2
      : sepCols === 0 ? indent + 2
      : sepCols >= 5 ? indent + 2 : col;
    return { bullet: m[2], ordered: false, markerLen: 1,
      contentCol, indent, rest: expandLeadingTabs(line, contentCol) };
  }
  m = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/.exec(line);
  if (m) {
    const indent = m[1].length;
    const markerLen = m[2].length + 1;
    let col = indent + markerLen;
    for (let q = 0; q < m[4].length; q++) {
      col += m[4][q] === '\t' ? 4 - (col % 4) : 1;
    }
    const sepCols = col - indent - markerLen;
    const emptyLine = indent + markerLen + m[4].length >= line.length;
    const contentCol = emptyLine ? indent + markerLen + 1
      : sepCols === 0 ? indent + markerLen + 1
      : sepCols >= 5 ? indent + markerLen + 1 : col;
    return { bullet: null, ordered: true, num: parseInt(m[2], 10), delim: m[3],
      markerLen, contentCol, indent, rest: expandLeadingTabs(line, contentCol) };
  }
  return null;
}

// Parse a link title starting at lines[startLine][startCol] (the opening
// quote). The title may run over several lines; the closing quote must be
// followed by nothing but spaces on its line. Returns {title, next} with
// next the index past the title's last line, or null.
function parseTitleMulti(lines, startLine, startCol, end) {
  const open = lines[startLine][startCol];
  const close = open === '(' ? ')' : open;
  let out = '';
  let li = startLine;
  let col = startCol + 1;
  for (;;) {
    const line = lines[li];
    while (col < line.length) {
      const c = line[col];
      if (c === '\\' && col + 1 < line.length && PUNCT_RE.test(line[col + 1])) {
        out += line[col + 1];
        col += 2;
        continue;
      }
      if (c === close) {
        if (!/^[ \t]*$/.test(line.slice(col + 1))) return null;
        return { title: out, next: li + 1 };
      }
      if (open === '(' && c === '(') return null;
      out += c;
      col++;
    }
    li++;
    if (li >= end || isBlank(lines[li])) return null;
    out += '\n';
    col = 0;
  }
}

// Parse a link reference definition starting at lines[i]. The label may
// span lines; the destination may be on the next line; the title may span
// lines. Returns {label, dest, title, next} (next = index past the
// definition) or null.
function parseLinkDef(lines, i, end) {
  const line = lines[i];
  const m = /^( {0,3})\[/.exec(line);
  if (!m) return null;
  // Label: scan across lines for the matching ']', honouring escapes and
  // balanced brackets. An unescaped '[' inside the label makes the
  // definition invalid (cm-546: '[ref[]: /uri' defines nothing).
  let labelText = '';
  let li = i;
  let col = m[1].length + 1;
  let found = false;
  while (li < end) {
    const ln = lines[li];
    while (col < ln.length) {
      const c = ln[col];
      if (c === '\\' && col + 1 < ln.length) { labelText += ln.slice(col, col + 2); col += 2; continue; }
      if (c === '[') return null;
      if (c === ']') { found = true; break; }
      labelText += c;
      col++;
    }
    if (found) break;
    labelText += '\n';
    li++;
    col = 0;
  }
  if (!found) return null;
  if (lines[li][col + 1] !== ':') return null;
  // Labels are compared raw: [foo\!] does not match a [foo!] definition.
  const label = labelText;
  if (label.trim() === '' || normalizeLabel(label).length > 999) return null;
  // Destination: same line after the ':', or the next line.
  let cur = li;
  let rest = lines[cur].slice(col + 2);
  let k = 0;
  while (k < rest.length && (rest[k] === ' ' || rest[k] === '\t')) k++;
  if (k >= rest.length) {
    cur++;
    if (cur >= end) return null;
    rest = lines[cur];
    k = 0;
    while (k < rest.length && (rest[k] === ' ' || rest[k] === '\t')) k++;
    if (k >= rest.length) return null;
  }
  let dest = null;
  let after = 0;
  if (rest[k] === '<') {
    const e = rest.indexOf('>', k + 1);
    if (e === -1) return null;
    const inner = rest.slice(k + 1, e);
    if (inner.indexOf('<') !== -1 || inner.indexOf('\n') !== -1) return null;
    dest = inner;
    after = e + 1;
  } else {
    let depth2 = 0;
    let p = k;
    while (p < rest.length) {
      const c = rest[p];
      if (c === ' ' || c === '\t') break;
      if (c === '\\' && p + 1 < rest.length && PUNCT_RE.test(rest[p + 1])) { p += 2; continue; }
      if (c === '(') depth2++;
      else if (c === ')') {
        if (depth2 === 0) break;
        depth2--;
      }
      p++;
    }
    if (p === k) return null;
    dest = rest.slice(k, p);
    after = p;
  }
  // Optional title: after whitespace on this line (a title must be
  // separated from the destination by whitespace), or on the next line.
  let title = null;
  let next = cur + 1;
  let tail = rest.slice(after);
  let tk = 0;
  while (tk < tail.length && (tail[tk] === ' ' || tail[tk] === '\t')) tk++;
  if (tk < tail.length) {
    if (tk === 0) return null;
    const qch = tail[tk];
    if (qch !== '"' && qch !== "'" && qch !== '(') return null;
    const parsed = parseTitleMulti(lines, cur, (col + 2) + after + tk, end);
    if (!parsed) return null;
    title = parsed.title;
    next = parsed.next;
  } else if (next < end) {
    const nl = lines[next];
    let q = 0;
    while (q < nl.length && (nl[q] === ' ' || nl[q] === '\t')) q++;
    if (q < nl.length && (nl[q] === '"' || nl[q] === "'" || nl[q] === '(')) {
      const parsed = parseTitleMulti(lines, next, q, end);
      if (parsed) {
        title = parsed.title;
        next = parsed.next;
      }
    }
  }
  return { label, dest, title, next };
}

// Is lines[i] a table delimiter row? If so return the alignments.
function tableDelimiter(line) {
  const t = line.trim();
  if (!/^\|?[\s:|-]+\|?$/.test(t)) return null;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
  const align = [];
  for (const cell of cells) {
    const c = cell.trim();
    if (!/^:?-+:?$/.test(c)) return null;
    if (c.startsWith(':') && c.endsWith(':')) align.push('center');
    else if (c.endsWith(':')) align.push('right');
    else if (c.startsWith(':')) align.push('left');
    else align.push(null);
  }
  return align;
}

function parseBlockList(lines, i0, i1, refs, endsNL, out, inItem, topLevel) {
  const tokens = [];
  let i = i0;
  let prevEnd = -1;
  while (i < i1) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    if (prevEnd !== -1 && out) {
      for (let q = prevEnd; q < i; q++) {
        if (isBlank(lines[q])) { out.blankSep = true; break; }
      }
    }
    // Link reference definition.
    if (/^( {0,3})\[/.test(line)) {
      const def = parseLinkDef(lines, i, i1);
      if (def) {
        const key = normalizeLabel(def.label);
        if (!(key in refs)) {
          refs[key] = { dest: unescapeBackslash(def.dest), title: def.title };
        }
        i = def.next;
        continue;
      }
    }
    // ATX heading.
    const atx = atxMatch(line);
    if (atx) {
      tokens.push({ t: 'heading', level: atx.level, inline: atx.inline });
      i++;
      prevEnd = i; continue;
    }
    // Fenced code.
    const fence = fenceMatch(line);
    if (fence) {
      const content = [];
      let j = i + 1;
      let closed = false;
      while (j < i1) {
        const l = lines[j];
        const cm = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (cm && cm[2][0] === fence.ch && cm[2].length >= fence.len) { closed = true; break; }
        // Fenced content is dedented by the fence indent at the top
        // level (doc-17: 3-space fence strips a tab). Inside a
        // container, backtick fences still dedent by the fence indent
        // (doc-15: 1-space fence strips 1 space) but tilde fences do
        // not (doc-29 keeps 2, doc-22 keeps 3); the container dedent
        // already removed the fence's share for those (doc-14).
        content.push(dedentWs(l, topLevel ? fence.indent : (fence.ch === '`' ? fence.indent : 0)));
        j++;
      }
      let text = '';
      if (!closed) {
        while (content.length && content[content.length - 1] === '') content.pop();
      }
      // Every content line ends with a newline except a trailing empty
      // one, which the closing fence already accounts for.
      text = content.join('\n');
      if (content.length && content[content.length - 1] !== '') text += '\n';
      const info = fence.info.replace(/\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g, '$1');
      const lang = info.trim().split(/\s+/)[0] || '';
      tokens.push({ t: 'code', text, lang, fenced: true });
      i = closed ? j + 1 : j;
      prevEnd = i; continue;
    }
    // HTML block.
    const hb = htmlBlockStart(line);
    if (hb) {
      const block = [line];
      let j = i + 1;
      if (hb <= 5) {
        if (htmlBlockEndKind(hb, line)) { /* single line */ }
        else {
          while (j < i1) {
            block.push(lines[j]);
            if (htmlBlockEndKind(hb, lines[j])) { j++; break; }
            j++;
          }
        }
        // The block's text ends with the newline of its last line only
        // when another NON-EMPTY line follows (cm-149/172/176/177/179:
        // `</table>\n<p>okay</p>`) or the block runs to the end of an
        // input that itself ends with a newline (cm-153). When a truly
        // empty line follows the block, no trailing newline is emitted
        // (cm-183/308/309: `<!-- foo --><pre>`, `<!-- --><ul>`; doc-01/03/
        // 05/...). A whitespace-only line (e.g. a lone tab) still counts
        // as a following line, so the newline IS emitted (doc-15).
        tokens.push({ t: 'html', text: block.join('\n') + ((j < i1 && lines[j] !== '') || (j >= i1 && endsNL) ? '\n' : '') });
        i = j;
        prevEnd = i; continue;
      }
      // Types 6 and 7 run to a blank line; their text carries no trailing
      // newline then, but does when the block runs to the end of the input.
      while (j < i1 && !isBlank(lines[j])) { block.push(lines[j]); j++; }
      tokens.push({ t: 'html', text: block.join('\n') + (j < i1 ? '' : (endsNL ? '\n' : '')) });
      i = j;
      prevEnd = i; continue;
    }
    // Thematic break.
    if (isHr(line)) {
      tokens.push({ t: 'hr' });
      i++;
      prevEnd = i; continue;
    }
    // Block quote.
    if (quoteStart(line) !== -1) {
      const qlines = [];
      let j = i;
      let lastPara = false;
      let inFence = null;
      while (j < i1) {
        const l = lines[j];
        const qs = quoteStart(l);
        if (qs !== -1) {
          const rest = expandLeadingTabs(l, qs);
          qlines.push(rest);
          inFence = fenceStep(rest, inFence);
          lastPara = isParaLine(rest, inItem);
          j++;
          continue;
        }
        // A blank line without a '>' marker ends the blockquote outright.
        if (isBlank(l)) break;
        // A fenced code block's lines are not lazy paragraph
        // continuations: a line without the '>' marker ends the quote
        // (and the fence, unclosed) instead of joining its content
        // (doc-01/05/14/17/21/34).
        if (inFence) break;
        if (lastPara && !interruptsPara(l, inItem)) {
          // A lazy line keeps its leading whitespace (doc-25 keeps 1
          // space), except when it starts with a list marker (cm-238
          // '    - bar' becomes '- bar', so it stays paragraph text).
          // A lazy setext underline is neutralised with four spaces,
          // so it stays paragraph text instead of becoming a heading.
          // It is joined onto the previous line, so the inner parse
          // reads it as paragraph continuation text rather than a
          // fresh block start.
          const stripped = l.replace(/^[ \t]+/, '');
          const isMarker = listMarker(stripped) !== null;
          qlines[qlines.length - 1] += '\n' + (isSetext(stripped) ? '    ' + stripped : isMarker ? stripped : l);
          j++;
          continue;
        }
        break;
      }
      tokens.push({ t: 'quote', children: parseBlockList(qlines, 0, qlines.length, refs, false, undefined, inItem) });
      i = j;
      prevEnd = i; continue;
    }
    // List.
    const marker = listMarker(line);
    if (marker) {
      const r = parseList(lines, i, i1, refs, endsNL, inItem);
      tokens.push(r.token);
      i = r.next;
      prevEnd = i; continue;
    }
    // Table: header line plus delimiter row.
    if (line.indexOf('|') !== -1 && i + 1 < i1) {
      const align = tableDelimiter(lines[i + 1]);
      if (align) {
        const header = splitCells(line);
        if (header.length === align.length) {
          const rows = [];
          let j = i + 2;
          // A whitespace-only line containing a tab is a row (an empty
          // row: doc-33's '\t' line, doc-02's '\t' line). A line that is
          // empty or spaces-only ends the table (doc-19/doc-24's '   '
          // lines). A block-start line ends it too.
          while (j < i1 && lines[j] !== '' && !/^[ ]+$/.test(lines[j]) &&
              !interruptsPara(lines[j], inItem)) {
            rows.push(splitCells(lines[j]));
            j++;
          }
          tokens.push({ t: 'table', header, align, rows });
          i = j;
          prevEnd = i; continue;
        }
      }
    }
    // Indented code.
    if (indentOf(line) >= 4) {
      const content = [];
      let j = i;
      while (j < i1) {
        const l = lines[j];
        if (/^[ \t]*$/.test(l)) {
          // A whitespace-only line belongs to the code when an indented
          // line follows it; its content keeps the spaces past the first
          // four (so a six-space line contributes two spaces).
          let k = j + 1;
          while (k < i1 && /^[ \t]*$/.test(lines[k])) k++;
          if (k < i1 && indentOf(lines[k]) >= 4) {
            while (j < k) { content.push(stripCols(lines[j], 4)); j++; }
            continue;
          }
          break;
        }
        if (indentOf(l) >= 4) { content.push(stripCols(l, 4)); j++; continue; }
        break;
      }
      let text = '';
      for (const cl of content) text += cl + '\n';
      tokens.push({ t: 'code', text, lang: '', fenced: false });
      i = j;
      prevEnd = i; continue;
    }
    // Paragraph (or setext heading).
    {
      const plines = [];
      let j = i;
      let headingLevel = 0;
      while (j < i1) {
        const l = lines[j];
        if (isBlank(l) && !(l !== '' && j === i1 - 1 && !endsNL)) break;
        if (plines.length > 0) {
          const se = isSetext(l);
          if (se) { headingLevel = se; j++; break; }
          if (interruptsPara(l, inItem)) break;
        }
        plines.push(l);
        j++;
      }
      if (headingLevel) {
        tokens.push({ t: 'heading', level: headingLevel,
          inline: plines.map((x) => x.trim()).join('\n') });
      } else {
        tokens.push({ t: 'para', inline: plines.join('\n') });
      }
      i = j;
      prevEnd = i; continue;
    }
  }
  return tokens;
}

function sameListKind(a, b) {
  if (a.ordered !== b.ordered) return false;
  if (!a.ordered) return a.bullet === b.bullet;
  return a.delim === b.delim;
}

function parseList(lines, i, end, refs, endsNL, inItem) {
  const first = listMarker(lines[i]);
  const ordered = first.ordered;
  const start = ordered ? first.num : null;
  const items = [];
  let loose = false;
  let j = i;
  while (j < end) {
    const line = lines[j];
    if (isBlank(line)) {
      let k = j;
      while (k < end && isBlank(lines[k])) k++;
      if (k < end) {
        const mk = listMarker(lines[k]);
        if (mk && !isHr(lines[k]) && sameListKind(mk, first)) { loose = true; j = k; continue; }
      }
      break;
    }
    // A thematic break ends the list instead of becoming an item.
    if (isHr(line)) break;
    const mk = listMarker(line);
    if (!mk || !sameListKind(mk, first)) break;
    const contentCol = mk.contentCol;
    const itemLines = [mk.rest];
    let p = j + 1;
    let lastPara = isParaLine(mk.rest, inItem);
    while (p < end) {
      const l = lines[p];
      if (isBlank(l)) {
        // An item with no content yet ends at a blank line: the indented
        // lines after it belong to a following block, not to the item.
        if (!itemLines.some((x) => !isBlank(x))) break;
        let k = p;
        while (k < end && isBlank(lines[k])) k++;
        if (k >= end) { p = k; break; }
        const nl = lines[k];
        if (indentOf(nl) >= contentCol) {
          while (p < k) { itemLines.push(''); p++; }
          continue;
        }
        const nmk = listMarker(nl);
        if (nmk && !isHr(nl) && sameListKind(nmk, first)) {
          loose = true;
          while (p < k) { itemLines.push(''); p++; }
          break;
        }
        break;
      }
      if (indentOf(l) >= contentCol) {
        const ded = expandLeadingTabs(l, contentCol);
        itemLines.push(ded);
        lastPara = isParaLine(ded, inItem);
        p++;
        continue;
      }
      const nmk = listMarker(l);
      // Any list marker ends the item: a same-kind marker starts the
      // next sibling, a different kind starts a new list. A marker line
      // is never a lazy paragraph continuation (cm-302: '3) baz' after
      // a '.' list starts a new list instead of joining the paragraph).
      if (nmk) break;
      if (lastPara && !interruptsPara(l, inItem)) {
        const stripped = l.replace(/^[ \t]+/, '');
        // A lazy continuation keeps its leading spaces (doc-22 keeps
        // 3, doc-26 keeps 2, doc-17 keeps 1) — except when it starts
        // with a list marker (cm-238 '    - bar' becomes '- bar', so
        // it stays paragraph text) or when this item's marker is
        // indented by 2 or more (cm-291 '    with two lines.' loses
        // its spaces). A setext underline is re-indented so it stays
        // paragraph text.
        const isMarker = listMarker(stripped) !== null;
        const keep = !isMarker && mk.indent <= 1;
        itemLines[itemLines.length - 1] += '\n' + (isSetext(stripped) ? '    ' + stripped : keep ? l : stripped);
        p++;
        continue;
      }
      break;
    }
    while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) itemLines.pop();
    let task = false;
    let checked = false;
    if (itemLines.length > 0) {
      const tm = /^\[([ xX])\]([ \t]|$)/.exec(itemLines[0]);
      if (tm) {
        task = true;
        checked = tm[1] !== ' ';
        itemLines[0] = itemLines[0].slice(3);
      }
    }
    const childOut = {};
    const children = parseBlockList(itemLines, 0, itemLines.length, refs, false, childOut, true);
    if (childOut.blankSep) loose = true;
    items.push({ task, checked, children });
    j = p;
  }
  return { token: { t: 'list', ordered, start, tight: !loose, items }, next: j };
}

// ---- Rendering -----------------------------------------------------------

function renderItemChildren(children, tight, refs, checkbox) {
  let out = '';
  for (let k = 0; k < children.length; k++) {
    const ch = children[k];
    if (tight && ch.t === 'para') {
      out += renderInline(ch.inline, refs);
    } else if (ch.t === 'para') {
      // A loose item's checkbox goes inside its first paragraph
      // (doc-05), not before the '<p>'.
      out += '<p>' + (k === 0 && checkbox ? checkbox : '') +
        renderInline(ch.inline, refs) + '</p>\n';
    } else {
      out += renderBlocks([ch], refs);
    }
  }
  // The checkbox has nowhere to sit inside a paragraph when the first
  // child is not one: fall back to putting it before the children.
  if (checkbox && (!children.length || children[0].t !== 'para') && !tight) {
    out = checkbox + out;
  }
  return out;
}

function renderBlocks(tokens, refs) {
  let out = '';
  for (const tk of tokens) {
    switch (tk.t) {
      case 'heading':
        out += '<h' + tk.level + '>' + renderInline(tk.inline, refs) + '</h' + tk.level + '>\n';
        break;
      case 'para':
        out += '<p>' + renderInline(tk.inline, refs) + '</p>\n';
        break;
      case 'code':
        out += '<pre><code' + (tk.lang ? ' class="language-' + escText(tk.lang) + '"' : '') + '>' +
          esc(tk.text) + '</code></pre>\n';
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'html':
        out += tk.text;
        break;
      case 'quote':
        out += '<blockquote>\n' + renderBlocks(tk.children, refs) + '</blockquote>\n';
        break;
      case 'table': {
        let s = '<table>\n<thead>\n<tr>\n';
        for (let c = 0; c < tk.header.length; c++) {
          s += '<th' + (tk.align[c] ? ' align="' + tk.align[c] + '"' : '') + '>' +
            renderInline(tk.header[c], refs) + '</th>\n';
        }
        s += '</tr>\n</thead>\n';
        if (tk.rows.length) {
          s += '<tbody>';
          for (const row of tk.rows) {
            s += '<tr>\n';
            for (let c = 0; c < tk.header.length; c++) {
              const cell = c < row.length ? row[c] : '';
              s += '<td' + (tk.align[c] ? ' align="' + tk.align[c] + '"' : '') + '>' +
                renderInline(cell, refs) + '</td>\n';
            }
            s += '</tr>\n';
          }
          s += '</tbody>';
        }
        s += '</table>\n';
        out += s;
        break;
      }
      case 'list': {
        let s = tk.ordered
          ? '<ol' + (tk.start !== 1 ? ' start="' + tk.start + '"' : '') + '>\n'
          : '<ul>\n';
        for (const item of tk.items) {
          s += '<li>';
          const checkbox = item.task
            ? (item.checked
              ? '<input checked="" disabled="" type="checkbox">'
              : '<input disabled="" type="checkbox">')
            : null;
          // A tight item's checkbox sits before its (paragraph-less)
          // content; a loose item's goes inside its first paragraph.
          if (checkbox && tk.tight) s += checkbox;
          s += renderItemChildren(item.children, tk.tight, refs,
            checkbox && !tk.tight ? checkbox : null);
          s += '</li>\n';
        }
        s += tk.ordered ? '</ol>\n' : '</ul>\n';
        out += s;
        break;
      }
    }
  }
  return out;
}

export function parse(markdown) {
  const src = String(markdown);
  // Preprocessing: normalise line endings. Tabs are NOT expanded globally
  // (marked keeps them in text and code); only the leading whitespace run
  // of each line is expanded, to the next multiple of four columns, so
  // indentation tests see columns while mid-line tabs survive verbatim.
  const raw = src.replace(/\r\n?/g, '\n');
  const endsNL = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (endsNL) lines.pop();
  // No global tab expansion: indentation is already column-counted by
  // indentOf / expandLeadingTabs / dedentWs wherever it matters, and
  // expanding here would rewrite tabs that belong in the output (a tab at
  // the start of a top-level fenced-code line stays a tab, doc-01/02).
  // Tabs that cross a container boundary are expanded at their absolute
  // column by expandLeadingTabs when the container is stripped.
  const refs = {};
  const tokens = parseBlockList(lines, 0, lines.length, refs, endsNL, undefined, undefined, true);
  return renderBlocks(tokens, refs);
}

// Remove `cutCols` columns from the start of a line, counting a tab as
// advancing to the next multiple of four, WITHOUT expanding any tab that
// remains leading afterwards. Used for indented code: after the four
// code-indent columns are stripped, a tab that follows stays a literal
// tab (doc-02: `    \tindented` -> `\tindented`), unlike container
// dedents (expandLeadingTabs), which expand it at its absolute column.
function stripCols(line, cutCols) {
  let col = 0;
  let i = 0;
  let out = '';
  while (i < line.length && col < cutCols) {
    const c = line[i];
    if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cutCols) { col += w; i++; }
      else { out += ' '.repeat(col + w - cutCols); col += w; i++; }
    } else { col++; i++; }
  }
  return out + line.slice(i);
}

// Expand the tabs in a line's leading whitespace run, relative to the
// line's own columns, and drop `cutCols` columns from its start. Only the
// cut columns are consumed: a tab that straddles the cut boundary leaves
// spaces for its remaining width. Any tab that is still leading after the
// cut is expanded to spaces at its ABSOLUTE column (a tab at column 7 is
// one space wide, not four), so a tab that crossed a container boundary
// keeps its true width: `>\t\tfoo` and `-\t\tfoo` both yield six spaces
// of indent, i.e. indented code containing two spaces (cm-006/007), and a
// fenced-code line `       \tindented` inside a list item yields one
// space (doc-06). Tabs after the first non-whitespace character are
// content and stay verbatim (cm-001/002/003).
function expandLeadingTabs(line, cutCols) {
  let col = 0;
  let i = 0;
  let out = '';
  while (i < line.length && col < cutCols) {
    const c = line[i];
    if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cutCols) { col += w; i++; }
      else { out += ' '.repeat(col + w - cutCols); col += w; i++; }
    } else { col++; i++; }
  }
  // Expand any tabs that are still leading, at their absolute columns.
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === '\t') {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      col += w;
      i++;
    } else { out += ' '; col++; i++; }
  }
  return out + line.slice(i);
}

// Column of the '>' that starts a blockquote on this line, plus the
// columns it and its optional following space occupy; -1 when the line
// does not start a blockquote.
function quoteStart(line) {
  let col = 0;
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    col += line[i] === '\t' ? 4 - (col % 4) : 1;
    i++;
  }
  if (line[i] !== '>' || col > 3) return -1;
  return col + 1 + ((line[i + 1] === ' ' || line[i + 1] === '\t') ? 1 : 0);
}

// Remove `cols` columns from the start of a line, counting a tab as
// advancing to the next multiple of four from its position. A tab that
// straddles the boundary leaves spaces for its remaining width.
function removeCols(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const c = line[i];
    if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else return ' '.repeat(col + w - cols) + line.slice(i + 1);
    } else { col++; i++; }
  }
  return line.slice(i);
}
