// RFC 4180 records: quoted fields may hold the delimiter, newlines and "" for a quote. CRLF or LF line ends, an
// optional byte order mark, blank lines dropped. The delimiter is whichever of , and ; appears more often outside
// quotes on the first line (Strong writes ; in some locales, where decimals use a comma).
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = delimiter(src);
  const out: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) out.push(row);
  return out;
}

function delimiter(src: string): ',' | ';' {
  let commas = 0, semis = 0, quoted = false;
  for (const ch of src) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}
