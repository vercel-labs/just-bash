/**
 * Pure JavaScript bzip2 compressor.
 *
 * Implements the bzip2 compression algorithm (public domain, Julian Seward 1996).
 * Pipeline: RLE1 → BWT → MTF → RLE2 (RUNA/RUNB) → Huffman → bitstream output.
 *
 * This exists because no permissively-licensed JS bzip2 compressor is available
 * on npm. Decompression uses the MIT-licensed `seek-bzip` package instead.
 */

// ---------- CRC32 for bzip2 (same polynomial as standard CRC32) ----------

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let j = 0; j < 8; j++) {
      c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, byte: number): number {
  return ((crc << 8) ^ CRC32_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
}

// ---------- Bit writer ----------

class BitWriter {
  private buffer: number[] = [];
  private current = 0;
  private bitCount = 0;

  writeBits(n: number, value: number): void {
    for (let i = n - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((value >>> i) & 1);
      this.bitCount++;
      if (this.bitCount === 8) {
        this.buffer.push(this.current);
        this.current = 0;
        this.bitCount = 0;
      }
    }
  }

  writeBit(value: number): void {
    this.current = (this.current << 1) | (value & 1);
    this.bitCount++;
    if (this.bitCount === 8) {
      this.buffer.push(this.current);
      this.current = 0;
      this.bitCount = 0;
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.buffer.push(this.current << (8 - this.bitCount));
    }
    return new Uint8Array(this.buffer);
  }
}

// ---------- RLE1: Initial run-length encoding ----------
// Runs of 4+ identical bytes become: byte byte byte byte (count-4)
// where count-4 is 0..251

function rle1Encode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    let runLen = 1;
    while (
      i + runLen < data.length &&
      data[i + runLen] === ch &&
      runLen < 255
    ) {
      runLen++;
    }
    if (runLen >= 4) {
      out.push(ch, ch, ch, ch);
      out.push(runLen - 4);
      i += runLen;
    } else {
      out.push(ch);
      i++;
    }
  }
  return new Uint8Array(out);
}

// ---------- Burrows-Wheeler Transform ----------
// Uses prefix-doubling suffix array construction: O(n log² n) time, O(n) space.

function bwt(data: Uint8Array): { transformed: Uint8Array; pointer: number } {
  const n = data.length;
  if (n === 0) {
    return { transformed: new Uint8Array(0), pointer: 0 };
  }

  // Build suffix array of the doubled data (rotation = suffix of doubled string)
  // using prefix-doubling algorithm.
  const sa = buildSuffixArrayForRotations(data);

  const transformed = new Uint8Array(n);
  let pointer = 0;
  for (let i = 0; i < n; i++) {
    if (sa[i] === 0) {
      pointer = i;
      transformed[i] = data[n - 1];
    } else {
      transformed[i] = data[sa[i] - 1];
    }
  }

  return { transformed, pointer };
}

/**
 * Build a suffix array for circular rotations using prefix doubling.
 * O(n log² n) time with O(n) space — fast enough for bzip2 blocks up to 900KB.
 */
function buildSuffixArrayForRotations(data: Uint8Array): Int32Array {
  const n = data.length;
  const sa = new Int32Array(n);
  const rank = new Int32Array(n);

  // Initialize ranks from byte values
  for (let i = 0; i < n; i++) {
    sa[i] = i;
    rank[i] = data[i];
  }

  // Prefix doubling: sort by first 2^k characters of each rotation
  for (let gap = 1; gap < n; gap *= 2) {
    // Sort by (rank[i], rank[(i+gap)%n])
    // Use a comparison-based sort with the current rank array
    const r = rank.slice(); // snapshot ranks before sorting
    sa.sort((a, b) => {
      if (r[a] !== r[b]) return r[a] - r[b];
      return r[(a + gap) % n] - r[(b + gap) % n];
    });

    // Recompute ranks based on sorted order
    rank[sa[0]] = 0;
    for (let i = 1; i < n; i++) {
      // Same rank if both primary and secondary keys match
      if (
        r[sa[i]] === r[sa[i - 1]] &&
        r[(sa[i] + gap) % n] === r[(sa[i - 1] + gap) % n]
      ) {
        rank[sa[i]] = rank[sa[i - 1]];
      } else {
        rank[sa[i]] = rank[sa[i - 1]] + 1;
      }
    }

    // If all ranks are unique, we're done
    if (rank[sa[n - 1]] === n - 1) break;
  }

  return sa;
}

// ---------- Move-to-Front transform ----------

function mtfEncode(
  data: Uint8Array,
  symbolsInUse: boolean[],
): { encoded: Uint16Array; length: number } {
  // Build initial MTF list from symbols actually in use
  const mtfList: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (symbolsInUse[i]) {
      mtfList.push(i);
    }
  }

  // Map byte values to their index in the used-symbols list
  const byteToIndex: number[] = new Array(256).fill(-1);
  for (let i = 0; i < mtfList.length; i++) {
    byteToIndex[mtfList[i]] = i;
  }

  const encoded = new Uint16Array(data.length);
  const list = mtfList.slice(); // working copy

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    // Find position of this byte in the MTF list
    let pos = 0;
    while (list[pos] !== byte) pos++;

    encoded[i] = pos;

    // Move to front
    if (pos > 0) {
      const val = list[pos];
      for (let j = pos; j > 0; j--) {
        list[j] = list[j - 1];
      }
      list[0] = val;
    }
  }

  return { encoded, length: data.length };
}

// ---------- RLE2: Zero run-length encoding (RUNA/RUNB) ----------
// Zeros are encoded as base-2 sequences of RUNA(0) and RUNB(1)
// Non-zero values are incremented by 1

function rle2Encode(
  mtfData: Uint16Array,
  mtfLen: number,
  numSymbolsInUse: number,
): { symbols: Uint16Array; length: number; eob: number } {
  const RUNA = 0;
  const RUNB = 1;
  const eob = numSymbolsInUse + 1; // End-of-block symbol

  const symbols: number[] = [];
  let i = 0;

  while (i < mtfLen) {
    if (mtfData[i] === 0) {
      // Count run of zeros
      let runLen = 0;
      while (i < mtfLen && mtfData[i] === 0) {
        runLen++;
        i++;
      }
      // Encode run length as RUNA/RUNB sequence (bijective base-2)
      // runLen = sum of (digit+1) * 2^position
      // 1 → RUNA, 2 → RUNB, 3 → RUNA RUNA, 4 → RUNB RUNA, etc.
      let n = runLen;
      while (n > 0) {
        n--;
        if (n & 1) {
          symbols.push(RUNB);
        } else {
          symbols.push(RUNA);
        }
        n >>>= 1;
      }
    } else {
      // Non-zero MTF values are incremented by 1 (to make room for RUNA/RUNB)
      symbols.push(mtfData[i] + 1);
      i++;
    }
  }

  symbols.push(eob);

  const result = new Uint16Array(symbols.length);
  for (let j = 0; j < symbols.length; j++) {
    result[j] = symbols[j];
  }

  return { symbols: result, length: symbols.length, eob };
}

// ---------- Huffman coding ----------

interface HuffmanTable {
  codeLengths: number[];
  maxLen: number;
  minLen: number;
}

function buildHuffmanTable(
  freqs: number[],
  numSymbols: number,
  maxCodeLen: number,
): HuffmanTable {
  // Build Huffman tree using package-merge algorithm for length-limited codes
  // First, use a simple approach: build standard Huffman, then limit lengths

  if (numSymbols <= 1) {
    const lengths = new Array(freqs.length).fill(0);
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] > 0) lengths[i] = 1;
    }
    return { codeLengths: lengths, maxLen: 1, minLen: 1 };
  }

  // Standard Huffman tree construction
  interface HNode {
    freq: number;
    symbol: number;
    left: HNode | null;
    right: HNode | null;
  }

  const nodes: HNode[] = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] > 0) {
      nodes.push({ freq: freqs[i], symbol: i, left: null, right: null });
    }
  }

  if (nodes.length === 0) {
    return {
      codeLengths: new Array(freqs.length).fill(0),
      maxLen: 0,
      minLen: 0,
    };
  }

  if (nodes.length === 1) {
    const lengths = new Array(freqs.length).fill(0);
    lengths[nodes[0].symbol] = 1;
    return { codeLengths: lengths, maxLen: 1, minLen: 1 };
  }

  // Build tree
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.freq - b.freq);
    // nodes.length > 1 guarantees both shifts return a value
    const left = nodes.shift() as HNode;
    const right = nodes.shift() as HNode;
    nodes.push({
      freq: left.freq + right.freq,
      symbol: -1,
      left,
      right,
    });
  }

  // Extract code lengths
  const codeLengths = new Array(freqs.length).fill(0);
  function traverse(node: HNode, depth: number): void {
    if (!node.left && !node.right) {
      codeLengths[node.symbol] = depth;
      return;
    }
    if (node.left) traverse(node.left, depth + 1);
    if (node.right) traverse(node.right, depth + 1);
  }
  traverse(nodes[0], 0);

  // Limit code lengths to maxCodeLen using the heuristic approach
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < codeLengths.length; i++) {
      if (codeLengths[i] > maxCodeLen) {
        codeLengths[i] = maxCodeLen;
        changed = true;
      }
    }
    if (changed) {
      // Verify Kraft inequality and adjust if needed
      let kraft = 0;
      for (let i = 0; i < codeLengths.length; i++) {
        if (codeLengths[i] > 0) {
          kraft += 1.0 / (1 << codeLengths[i]);
        }
      }
      if (kraft > 1.0) {
        // Need to increase some shorter codes
        // Find the shortest code and increase it
        for (let len = 1; len < maxCodeLen && kraft > 1.0; len++) {
          for (let i = 0; i < codeLengths.length && kraft > 1.0; i++) {
            if (codeLengths[i] === len) {
              codeLengths[i]++;
              kraft -= 1.0 / (1 << len) - 1.0 / (1 << (len + 1));
            }
          }
        }
      }
      changed = false; // We've adjusted, check again
      for (let i = 0; i < codeLengths.length; i++) {
        if (codeLengths[i] > maxCodeLen) {
          changed = true;
          break;
        }
      }
    }
  }

  let minLen = maxCodeLen;
  let actualMaxLen = 0;
  for (let i = 0; i < codeLengths.length; i++) {
    if (codeLengths[i] > 0) {
      if (codeLengths[i] < minLen) minLen = codeLengths[i];
      if (codeLengths[i] > actualMaxLen) actualMaxLen = codeLengths[i];
    }
  }

  return { codeLengths, maxLen: actualMaxLen, minLen };
}

function generateCanonicalCodes(
  codeLengths: number[],
  numSymbols: number,
): { codes: number[]; lengths: number[] } {
  const codes = new Array(numSymbols).fill(0);
  const lengths = codeLengths.slice(0, numSymbols);

  // Count codes of each length
  const maxLen = Math.max(...lengths, 0);
  const blCount = new Array(maxLen + 1).fill(0);
  for (let i = 0; i < numSymbols; i++) {
    if (lengths[i] > 0) blCount[lengths[i]]++;
  }

  // Find the numerical value of the smallest code for each code length
  const nextCode = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  // Assign codes
  for (let i = 0; i < numSymbols; i++) {
    if (lengths[i] > 0) {
      codes[i] = nextCode[lengths[i]]++;
    }
  }

  return { codes, lengths };
}

// ---------- Block compression ----------

function compressBlock(
  writer: BitWriter,
  blockData: Uint8Array,
  blockCRC: number,
): void {
  // Block header magic: 0x314159265359 (pi)
  writer.writeBits(24, 0x314159);
  writer.writeBits(24, 0x265359);

  // Block CRC
  writer.writeBits(32, blockCRC);

  // Randomized flag (always 0 in modern bzip2)
  writer.writeBit(0);

  // Step 1: RLE1 encoding
  const rle1Data = rle1Encode(blockData);

  // Step 2: BWT
  const { transformed, pointer } = bwt(rle1Data);

  // BWT pointer (24 bits)
  writer.writeBits(24, pointer);

  // Step 3: Determine symbols in use
  const symbolsInUse: boolean[] = new Array(256).fill(false);
  for (let i = 0; i < transformed.length; i++) {
    symbolsInUse[transformed[i]] = true;
  }

  // Write symbol map (16 groups of 16)
  const inUse16: boolean[] = new Array(16).fill(false);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      if (symbolsInUse[i * 16 + j]) {
        inUse16[i] = true;
        break;
      }
    }
  }

  for (let i = 0; i < 16; i++) {
    writer.writeBit(inUse16[i] ? 1 : 0);
  }
  for (let i = 0; i < 16; i++) {
    if (inUse16[i]) {
      for (let j = 0; j < 16; j++) {
        writer.writeBit(symbolsInUse[i * 16 + j] ? 1 : 0);
      }
    }
  }

  // Count symbols in use
  let numSymbolsInUse = 0;
  for (let i = 0; i < 256; i++) {
    if (symbolsInUse[i]) numSymbolsInUse++;
  }

  // Step 4: MTF
  const { encoded: mtfData, length: mtfLen } = mtfEncode(
    transformed,
    symbolsInUse,
  );

  // Step 5: RLE2
  const { symbols, length: symLen } = rle2Encode(
    mtfData,
    mtfLen,
    numSymbolsInUse,
  );

  // Total alphabet size: numSymbolsInUse + 2 (RUNA, RUNB, symbols 1..n, EOB)
  const alphaSize = numSymbolsInUse + 2;

  // Step 6: Build Huffman table(s)
  // For simplicity, use a single Huffman table (nGroups=1 is not valid in bzip2,
  // minimum is 2, but we'll use the minimum number appropriate for data size)
  const GROUP_SIZE = 50;
  const nSelectors = Math.ceil(symLen / GROUP_SIZE);

  // Determine number of tables (bzip2 uses 2-6 based on data size)
  let nGroups: number;
  if (symLen < 200) nGroups = 2;
  else if (symLen < 600) nGroups = 3;
  else if (symLen < 1200) nGroups = 4;
  else if (symLen < 2400) nGroups = 5;
  else nGroups = 6;

  // For simplicity with small data, cap nGroups
  if (nGroups > nSelectors) nGroups = Math.max(2, nSelectors);

  // Build frequency tables for each group
  // Simple approach: assign symbols to groups evenly, build one table per group
  // Then do a few iterations of optimization
  const groupFreqs: number[][] = [];
  for (let t = 0; t < nGroups; t++) {
    groupFreqs.push(new Array(alphaSize).fill(0));
  }

  // Initial assignment: distribute groups evenly across selectors
  const selectors = new Int32Array(nSelectors);
  for (let s = 0; s < nSelectors; s++) {
    selectors[s] = s % nGroups;
  }

  // Build initial frequency counts
  for (let s = 0; s < nSelectors; s++) {
    const start = s * GROUP_SIZE;
    const end = Math.min(start + GROUP_SIZE, symLen);
    const g = selectors[s];
    for (let i = start; i < end; i++) {
      groupFreqs[g][symbols[i]]++;
    }
  }

  // Ensure all symbols have at least frequency 1 to produce valid code lengths.
  // bzip2 requires every symbol in the alphabet to have a valid code (1-20).
  function ensureMinFreq(freqs: number[]): void {
    for (let i = 0; i < alphaSize; i++) {
      if (freqs[i] < 1) freqs[i] = 1;
    }
  }

  // Build Huffman tables
  const tables: HuffmanTable[] = [];
  for (let t = 0; t < nGroups; t++) {
    ensureMinFreq(groupFreqs[t]);
    tables.push(buildHuffmanTable(groupFreqs[t], alphaSize, 20));
  }

  // Iterate: reassign selectors to best table, rebuild tables
  for (let iter = 0; iter < 4; iter++) {
    // Reset frequencies
    for (let t = 0; t < nGroups; t++) {
      groupFreqs[t].fill(0);
    }

    // Reassign each group of symbols to the table with shortest encoding
    for (let s = 0; s < nSelectors; s++) {
      const start = s * GROUP_SIZE;
      const end = Math.min(start + GROUP_SIZE, symLen);

      let bestGroup = 0;
      let bestCost = Infinity;

      for (let t = 0; t < nGroups; t++) {
        let cost = 0;
        for (let i = start; i < end; i++) {
          cost += tables[t].codeLengths[symbols[i]] || 20;
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestGroup = t;
        }
      }

      selectors[s] = bestGroup;
      for (let i = start; i < end; i++) {
        groupFreqs[bestGroup][symbols[i]]++;
      }
    }

    // Rebuild tables
    for (let t = 0; t < nGroups; t++) {
      ensureMinFreq(groupFreqs[t]);
      tables[t] = buildHuffmanTable(groupFreqs[t], alphaSize, 20);
    }
  }

  // Write number of Huffman trees
  writer.writeBits(3, nGroups);

  // Write number of selectors
  writer.writeBits(15, nSelectors);

  // MTF encode selectors
  const selectorMtf: number[] = [];
  const selectorList: number[] = [];
  for (let i = 0; i < nGroups; i++) selectorList.push(i);

  for (let s = 0; s < nSelectors; s++) {
    const val = selectors[s];
    let pos = 0;
    while (selectorList[pos] !== val) pos++;

    selectorMtf.push(pos);

    // Move to front
    if (pos > 0) {
      const v = selectorList[pos];
      for (let j = pos; j > 0; j--) {
        selectorList[j] = selectorList[j - 1];
      }
      selectorList[0] = v;
    }
  }

  // Write selectors as unary
  for (let s = 0; s < nSelectors; s++) {
    for (let j = 0; j < selectorMtf[s]; j++) {
      writer.writeBit(1);
    }
    writer.writeBit(0);
  }

  // Write Huffman tables (delta-encoded code lengths)
  for (let t = 0; t < nGroups; t++) {
    const lengths = tables[t].codeLengths;
    let currentLen = lengths[0];

    writer.writeBits(5, currentLen);

    for (let i = 0; i < alphaSize; i++) {
      const targetLen = lengths[i];
      while (currentLen < targetLen) {
        writer.writeBit(1);
        writer.writeBit(0); // increment
        currentLen++;
      }
      while (currentLen > targetLen) {
        writer.writeBit(1);
        writer.writeBit(1); // decrement
        currentLen--;
      }
      writer.writeBit(0); // done for this symbol
    }
  }

  // Write compressed data using Huffman codes
  for (let t = 0; t < nGroups; t++) {
    const { codes, lengths } = generateCanonicalCodes(
      tables[t].codeLengths,
      alphaSize,
    );
    tables[t] = Object.assign(tables[t], { _codes: codes, _lengths: lengths });
  }

  let selectorIdx = 0;
  let groupPos = 0;

  for (let i = 0; i < symLen; i++) {
    if (groupPos === 0 || groupPos >= GROUP_SIZE) {
      if (i > 0) selectorIdx++;
      groupPos = 0;
    }

    const tableIdx = selectors[selectorIdx];
    const table = tables[tableIdx] as HuffmanTable & {
      _codes: number[];
      _lengths: number[];
    };
    const sym = symbols[i];
    const len = table._lengths[sym];
    const code = table._codes[sym];

    if (len > 0) {
      writer.writeBits(len, code);
    }
    groupPos++;
  }
}

// ---------- Main compression function ----------

// Default maximum input size to prevent runaway compute (10MB).
// BWT is O(n log² n) which is acceptable up to this limit.
const DEFAULT_MAX_COMPRESS_SIZE = 10 * 1024 * 1024;

/**
 * Compress data using bzip2 algorithm.
 * @param data - Input data to compress
 * @param blockSizeLevel - Block size level 1-9 (x 100KB), default 9
 * @param maxSize - Maximum input size in bytes (default 10MB)
 * @returns Compressed bzip2 data
 */
export function bzip2Compress(
  data: Uint8Array,
  blockSizeLevel: number = 9,
  maxSize: number = DEFAULT_MAX_COMPRESS_SIZE,
): Uint8Array {
  if (blockSizeLevel < 1 || blockSizeLevel > 9) {
    throw new Error("Block size level must be 1-9");
  }
  if (data.length > maxSize) {
    throw new Error(
      `Input too large for bzip2 compression (${data.length} bytes, max ${maxSize})`,
    );
  }

  const blockSize = blockSizeLevel * 100000;
  const writer = new BitWriter();

  // Stream header
  writer.writeBits(8, 0x42); // 'B'
  writer.writeBits(8, 0x5a); // 'Z'
  writer.writeBits(8, 0x68); // 'h'
  writer.writeBits(8, 0x30 + blockSizeLevel); // '0' + level

  let combinedCRC = 0;

  // Process blocks
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + blockSize, data.length);
    const blockData = data.subarray(offset, end);

    // Compute block CRC
    let blockCRC = 0xffffffff;
    for (let i = 0; i < blockData.length; i++) {
      blockCRC = crc32Update(blockCRC, blockData[i]);
    }
    blockCRC = ~blockCRC >>> 0;

    // Update combined CRC
    combinedCRC = ((combinedCRC << 1) | (combinedCRC >>> 31)) >>> 0;
    combinedCRC = (combinedCRC ^ blockCRC) >>> 0;

    compressBlock(writer, blockData, blockCRC);
    offset = end;
  }

  // Stream footer magic: 0x177245385090 (sqrt(pi))
  writer.writeBits(24, 0x177245);
  writer.writeBits(24, 0x385090);

  // Combined CRC
  writer.writeBits(32, combinedCRC);

  return writer.finish();
}
