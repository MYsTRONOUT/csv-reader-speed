// Fast drop-in for csv-reader 1.0.0: identical answers, indexOf-driven scanning.
//
// The semantics are csv-reader's own (vendor/csv-reader/index.js in the kit):
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a
// line left with no characters is no record; outside quotes a CR not followed
// by LF is dropped (stray_cr); a field that opens with a quote runs to the
// next quote that is not doubled, "" inside it is one quote and each CRLF or
// lone CR inside it is read as LF; what follows its closing quote, up to the
// next comma or line break, is appended as it stands (quote_junk, when the
// field ends); a quote that never closes is a literal character and the text
// after it is read again as unquoted (unterminated_quote); a quote inside an
// unquoted field is a literal character; fields stay strings, never trimmed
// or converted; columns is the first record when header is true, else null;
// rows holds the records after it, each padded with "" (short_row) or cut
// (long_row) to the first record's width.
//
// The reference reads one character at a time. This one jumps: unquoted
// fields end at the next comma or line break found by indexOf, quoted fields
// end at the next quote found by indexOf, and only a field that actually
// holds a stray CR or an embedded line break falls back to a character loop.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break, exactly as the reference does: a CR not followed by LF is dropped
  // (stray_cr). Returns the field, how it ended and how many characters
  // were kept (`added`, which the quote_junk check reads).
  function readUnquoted(value) {
    let comma = text.indexOf(',', pos);
    let nl = text.indexOf('\n', pos);
    if (comma === -1) comma = Infinity;
    if (nl === -1) nl = Infinity;
    if (comma < nl) {
      const f = text.slice(pos, comma);
      if (f.indexOf('\r') === -1) {
        pos = comma + 1;
        return { value: value === '' ? f : value + f, ended: COMMA, added: f.length };
      }
      return readUnquotedSlow(value);
    }
    if (nl !== Infinity) {
      let end = nl;
      if (end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
      const f = text.slice(pos, end);
      if (f.indexOf('\r') === -1) {
        pos = nl + 1;
        line += 1;
        return { value: value === '' ? f : value + f, ended: BREAK, added: f.length };
      }
      return readUnquotedSlow(value);
    }
    const f = text.slice(pos);
    if (f.indexOf('\r') === -1) {
      pos = n;
      return { value: value === '' ? f : value + f, ended: END, added: f.length };
    }
    return readUnquotedSlow(value);
  }

  // The character-at-a-time read, used only when a field holds a stray CR.
  function readUnquotedSlow(value) {
    let added = 0;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: BREAK, added };
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return { value, ended: BREAK, added };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        continue;
      }
      value += text[pos];
      added += 1;
      pos += 1;
    }
    return { value, ended: END, added };
  }

  // Normalises a quoted field's raw content: each CRLF or lone CR inside
  // quotes is one LF, and the line count moves past every line break in it.
  function normalizeQuoted(raw) {
    let out = '';
    let i = 0;
    const m = raw.length;
    while (i < m) {
      const ch = raw.charCodeAt(i);
      if (ch === 13) {
        out += '\n';
        line += 1;
        i += raw.charCodeAt(i + 1) === 10 ? 2 : 1;
      } else {
        if (ch === 10) line += 1;
        out += raw[i];
        i += 1;
      }
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let segStart = pos + 1;
    let q = pos + 1;
    let close = -1;
    for (;;) {
      const hit = text.indexOf('"', q);
      if (hit === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(hit + 1) === 34) {
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, hit));
        parts.push('"');
        segStart = hit + 2;
        q = hit + 2;
        continue;
      }
      close = hit;
      break;
    }
    let raw;
    if (parts === null) {
      raw = text.slice(open + 1, close);
    } else {
      parts.push(text.slice(segStart, close));
      raw = parts.join('');
    }
    let value = raw;
    if (raw.indexOf('\r') !== -1) {
      value = normalizeQuoted(raw);
    } else if (raw.indexOf('\n') !== -1) {
      let cnt = 0;
      let idx = -1;
      while ((idx = raw.indexOf('\n', idx + 1)) !== -1) cnt += 1;
      line += cnt;
    }
    const after = close + 1;
    if (after >= n) {
      pos = n;
      return { value, ended: END };
    }
    const c = text.charCodeAt(after);
    if (c === 44) {
      pos = after + 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos = after + 1;
      line += 1;
      return { value, ended: BREAK };
    }
    if (c === 13 && text.charCodeAt(after + 1) === 10) {
      pos = after + 2;
      line += 1;
      return { value, ended: BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    pos = after;
    const junk = readUnquoted(value);
    if (junk.added > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
