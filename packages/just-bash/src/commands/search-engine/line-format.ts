// Automa modification: N1 ripgrep max-columns formatting without changing matches.

export interface LineFormatOptions {
  maxColumns?: number;
  maxColumnsPreview?: boolean;
}

/** rg tests byte length (including the source terminator), but previews characters. */
export function formatSearchLine(
  line: string,
  options: LineFormatOptions & { onlyMatching?: boolean },
  matching: boolean,
  hasTerminator: boolean,
  matchStarts: readonly number[] | undefined,
  chargeWork: () => void,
): string {
  const max = options.maxColumns ?? 0;
  if (!max) return line;
  let bytes = Number(hasTerminator);
  let scanned = 0;
  for (let index = 0; index < line.length && bytes <= max; index++) {
    if ((scanned++ & 1023) === 0) chargeWork();
    const point = line.codePointAt(index) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (point > 0xffff) index++;
  }
  if (bytes <= max) return line;
  if (!options.maxColumnsPreview) {
    return matchStarts?.length && !options.onlyMatching
      ? `[Omitted long line with ${matchStarts.length} matches]`
      : `[Omitted long ${matching ? "matching" : "context"} line]`;
  }
  // Do not split surrogate pairs or allocate an array proportional to the line.
  let end = 0;
  let columns = 0;
  while (end < line.length && columns < max) {
    if ((columns & 1023) === 0) chargeWork();
    end += (line.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
    columns++;
  }
  const preview = line.slice(0, end);
  if (!matchStarts?.length) return `${preview} [... omitted end of long line]`;
  let remaining = 0;
  for (const start of matchStarts) {
    chargeWork();
    if (start >= end) remaining++;
  }
  return `${preview} [... ${remaining} more ${remaining === 1 ? "match" : "matches"}]`;
}
