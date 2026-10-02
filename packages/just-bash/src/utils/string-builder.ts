const STRING_CHUNK_SIZE = 8192;

/** Build strings in bounded batches to avoid long ropes of single-character appends. */
export function createStringBuilder(inlineFragments = 0): {
  append: (value: string) => void;
  finish: () => string;
} {
  const parts: string[] = [];
  const chunk: string[] = [];
  let length = 0;
  let small: string | undefined = inlineFragments > 0 ? "" : undefined;
  let smallCount = 0;

  return {
    append(value: string) {
      // Callers with bounded, small output can opt into a cheap prefix.
      // Otherwise compact even short outputs, which may outlive this builder.
      if (small !== undefined) {
        if (smallCount++ < inlineFragments) {
          small += value;
          return;
        }
        chunk[length++] = small;
        small = undefined;
      }
      chunk[length++] = value;
      if (length === STRING_CHUNK_SIZE) {
        parts.push(chunk.join(""));
        // Overwrite the existing storage instead of growing a new array for
        // every batch. At most one batch's fragment references stay alive.
        length = 0;
      }
    },
    finish() {
      if (small !== undefined) return small;
      chunk.length = length;
      if (parts.length === 0) return chunk.join("");
      if (length > 0) {
        parts.push(chunk.join(""));
        length = 0;
        chunk.length = 0;
      }
      if (parts.length === 1) return parts[0];
      return parts.join("");
    },
  };
}
