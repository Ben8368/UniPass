export interface CsvRow {
  values: string[];
  line: number;
}

/** RFC 4180-compatible parser for user-selected password export files. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let atFieldStart = true;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = false;
      } else {
        value += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (character === '"' && atFieldStart) { quoted = true; atFieldStart = false; continue; }
    if (character === ",") { values.push(value); value = ""; atFieldStart = true; continue; }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      values.push(value);
      rows.push({ values, line: rowLine });
      values = []; value = ""; atFieldStart = true; line += 1; rowLine = line;
      continue;
    }
    value += character;
    atFieldStart = false;
  }
  if (quoted) throw new Error("CSV quote is not closed");
  if (value || values.length || text.endsWith(",")) rows.push({ values: [...values, value], line: rowLine });
  return rows;
}
