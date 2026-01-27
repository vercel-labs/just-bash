import * as require$$0 from "node:assert";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
class LZMAError extends Error {
  constructor(message, errno) {
    super(message);
    this.name = "LZMAError";
    this.errno = errno;
    this.code = errno;
    Error.captureStackTrace(this, this.constructor);
  }
}
class LZMAMemoryError extends LZMAError {
  constructor(errno) {
    super("Cannot allocate memory", errno);
    this.name = "LZMAMemoryError";
  }
}
class LZMAMemoryLimitError extends LZMAError {
  constructor(errno) {
    super("Memory usage limit was reached", errno);
    this.name = "LZMAMemoryLimitError";
  }
}
class LZMAFormatError extends LZMAError {
  constructor(errno) {
    super("File format not recognized", errno);
    this.name = "LZMAFormatError";
  }
}
class LZMAOptionsError extends LZMAError {
  constructor(errno) {
    super("Invalid or unsupported options", errno);
    this.name = "LZMAOptionsError";
  }
}
class LZMADataError extends LZMAError {
  constructor(errno) {
    super("Data is corrupt", errno);
    this.name = "LZMADataError";
  }
}
class LZMABufferError extends LZMAError {
  constructor(errno) {
    super("No progress is possible", errno);
    this.name = "LZMABufferError";
  }
}
class LZMAProgrammingError extends LZMAError {
  constructor(errno) {
    super("Programming error", errno);
    this.name = "LZMAProgrammingError";
  }
}
function createLZMAError(errno, message) {
  const LZMA_MEM_ERROR2 = 5;
  const LZMA_MEMLIMIT_ERROR2 = 6;
  const LZMA_FORMAT_ERROR2 = 7;
  const LZMA_OPTIONS_ERROR2 = 8;
  const LZMA_DATA_ERROR2 = 9;
  const LZMA_BUF_ERROR2 = 10;
  const LZMA_PROG_ERROR2 = 11;
  switch (errno) {
    case LZMA_MEM_ERROR2:
      return new LZMAMemoryError(errno);
    case LZMA_MEMLIMIT_ERROR2:
      return new LZMAMemoryLimitError(errno);
    case LZMA_FORMAT_ERROR2:
      return new LZMAFormatError(errno);
    case LZMA_OPTIONS_ERROR2:
      return new LZMAOptionsError(errno);
    case LZMA_DATA_ERROR2:
      return new LZMADataError(errno);
    case LZMA_BUF_ERROR2:
      return new LZMABufferError(errno);
    case LZMA_PROG_ERROR2:
      return new LZMAProgrammingError(errno);
    default: {
      const errorMessage = getErrorMessage(errno);
      return new LZMAError(errorMessage, errno);
    }
  }
}
function getErrorMessage(errno) {
  const messages2 = [
    "Operation completed successfully",
    "End of stream was reached",
    "Input stream has no integrity check",
    "Cannot calculate the integrity check",
    "Integrity check type is not available",
    "Cannot allocate memory",
    "Memory usage limit was reached",
    "File format not recognized",
    "Invalid or unsupported options",
    "Data is corrupt",
    "No progress is possible",
    "Programming error"
  ];
  if (errno < 0 || errno >= messages2.length) {
    return `Unknown LZMA error code: ${errno}`;
  }
  return messages2[errno];
}
class LZMAPool extends EventEmitter {
  /**
   * Create a new LZMA pool
   * @param maxConcurrent Maximum number of concurrent operations (default: 10)
   */
  constructor(maxConcurrent = 10) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.queue = [];
    this.metrics = {
      active: 0,
      queued: 0,
      completed: 0,
      failed: 0
    };
    if (maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be at least 1");
    }
  }
  /**
   * Compress data with automatic queue management
   * @param data Buffer to compress
   * @param opts LZMA compression options
   * @returns Promise that resolves to compressed buffer
   */
  async compress(data, opts) {
    return this.enqueue(() => xzAsync(data, opts));
  }
  /**
   * Decompress data with automatic queue management
   * @param data Compressed buffer to decompress
   * @param opts LZMA decompression options
   * @returns Promise that resolves to decompressed buffer
   */
  async decompress(data, opts) {
    return this.enqueue(() => unxzAsync(data, opts));
  }
  /**
   * Get current pool metrics
   * @returns Copy of current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }
  /**
   * Get number of tasks waiting in queue
   * @returns Queue length
   */
  get queueLength() {
    return this.queue.length;
  }
  /**
   * Get number of currently active tasks
   * @returns Active task count
   */
  get activeCount() {
    return this.metrics.active;
  }
  /**
   * Check if pool is at maximum capacity
   * @returns True if at capacity
   */
  get isAtCapacity() {
    return this.metrics.active >= this.maxConcurrent;
  }
  /**
   * Enqueue a task for execution
   * @param fn Task function returning Promise<Buffer>
   * @returns Promise that resolves when task completes
   */
  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.metrics.queued = this.queue.length;
      this.emit("queue", { ...this.metrics });
      this.processQueue();
    });
  }
  /**
   * Process tasks from queue respecting concurrency limit
   */
  processQueue() {
    if (this.metrics.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    const item = this.queue.shift();
    if (!item)
      return;
    this.metrics.active++;
    this.metrics.queued = this.queue.length;
    this.emit("start", { ...this.metrics });
    Promise.resolve().then(() => item.fn()).then((result) => {
      this.metrics.completed++;
      item.resolve(result);
      this.emit("complete", { ...this.metrics });
    }).catch((error) => {
      this.metrics.failed++;
      item.reject(error);
      this.emit("error-task", error, { ...this.metrics });
    }).finally(() => {
      this.metrics.active--;
      this.emit("metrics", { ...this.metrics });
      this.processQueue();
    });
  }
  /**
   * Wait for all active tasks to complete
   * Does not process new tasks added while waiting
   * @returns Promise that resolves when all active tasks are done
   */
  async drain() {
    if (this.metrics.active === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const checkDrained = () => {
        if (this.metrics.active === 0) {
          this.off("metrics", checkDrained);
          resolve();
        }
      };
      this.on("metrics", checkDrained);
    });
  }
  /**
   * Clear all pending tasks from the queue
   * Active tasks will continue to run
   * @returns Number of tasks removed from queue
   */
  clearQueue() {
    const cleared = this.queue.length;
    const error = new Error("Task cancelled: queue cleared");
    for (const task of this.queue) {
      task.reject(error);
    }
    this.queue = [];
    this.metrics.queued = 0;
    this.emit("metrics", { ...this.metrics });
    return cleared;
  }
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
const require$1 = createRequire(import.meta.url);
const bindingPath = path.resolve(path.join(__dirname$1, ".."));
const liblzma = require$1("node-gyp-build")(bindingPath);
const maxThreads = os.cpus().length;
const check = {
  NONE: liblzma.LZMA_CHECK_NONE,
  CRC32: liblzma.LZMA_CHECK_CRC32,
  CRC64: liblzma.LZMA_CHECK_CRC64,
  SHA256: liblzma.LZMA_CHECK_SHA256
};
const preset = {
  /** Default compression level (6) */
  DEFAULT: liblzma.LZMA_PRESET_DEFAULT,
  /** Extreme mode flag - slower but better compression */
  EXTREME: liblzma.LZMA_PRESET_EXTREME
};
const flag = {
  /** Tell decoder if input has no integrity check */
  TELL_NO_CHECK: liblzma.LZMA_TELL_NO_CHECK,
  /** Tell decoder if integrity check is unsupported */
  TELL_UNSUPPORTED_CHECK: liblzma.LZMA_TELL_UNSUPPORTED_CHECK,
  /** Tell decoder about any integrity check type */
  TELL_ANY_CHECK: liblzma.LZMA_TELL_ANY_CHECK,
  /** Allow concatenated XZ streams */
  CONCATENATED: liblzma.LZMA_CONCATENATED
};
const filter = {
  /** LZMA2 compression filter (required, must be last) */
  LZMA2: liblzma.LZMA_FILTER_LZMA2,
  /** BCJ filter for x86 executables */
  X86: liblzma.LZMA_FILTER_X86,
  /** BCJ filter for PowerPC executables */
  POWERPC: liblzma.LZMA_FILTER_POWERPC,
  /** BCJ filter for IA-64 executables */
  IA64: liblzma.LZMA_FILTER_IA64,
  /** BCJ filter for ARM executables */
  ARM: liblzma.LZMA_FILTER_ARM,
  /** BCJ filter for ARM-Thumb executables */
  ARMTHUMB: liblzma.LZMA_FILTER_ARMTHUMB,
  /** BCJ filter for SPARC executables */
  SPARC: liblzma.LZMA_FILTER_SPARC
};
const mode = {
  /** Fast compression mode - less memory, faster */
  FAST: liblzma.LZMA_MODE_FAST,
  /** Normal compression mode - better ratio */
  NORMAL: liblzma.LZMA_MODE_NORMAL
};
const LZMAAction = {
  /** Normal processing - continue encoding/decoding */
  RUN: liblzma.LZMA_RUN,
  /** Flush pending output synchronously */
  SYNC_FLUSH: liblzma.LZMA_SYNC_FLUSH,
  /** Flush and reset encoder state */
  FULL_FLUSH: liblzma.LZMA_FULL_FLUSH,
  /** Finish the stream - no more input */
  FINISH: liblzma.LZMA_FINISH
};
const LZMAStatus = {
  OK: liblzma.LZMA_OK,
  STREAM_END: liblzma.LZMA_STREAM_END,
  NO_CHECK: liblzma.LZMA_NO_CHECK,
  UNSUPPORTED_CHECK: liblzma.LZMA_UNSUPPORTED_CHECK,
  GET_CHECK: liblzma.LZMA_GET_CHECK,
  MEM_ERROR: liblzma.LZMA_MEM_ERROR,
  MEMLIMIT_ERROR: liblzma.LZMA_MEMLIMIT_ERROR,
  FORMAT_ERROR: liblzma.LZMA_FORMAT_ERROR,
  OPTIONS_ERROR: liblzma.LZMA_OPTIONS_ERROR,
  DATA_ERROR: liblzma.LZMA_DATA_ERROR,
  BUF_ERROR: liblzma.LZMA_BUF_ERROR,
  PROG_ERROR: liblzma.LZMA_PROG_ERROR
};
const LZMAFilter = {
  ...filter,
  X86_ALT: liblzma.LZMA_FILTER_X86,
  POWERPC_ALT: liblzma.LZMA_FILTER_POWERPC,
  IA64_ALT: liblzma.LZMA_FILTER_IA64,
  ARM_ALT: liblzma.LZMA_FILTER_ARM,
  ARMTHUMB_ALT: liblzma.LZMA_FILTER_ARMTHUMB,
  FILTERS_MAX: liblzma.LZMA_FILTERS_MAX
};
const LZMA_RUN = LZMAAction.RUN;
const LZMA_SYNC_FLUSH = LZMAAction.SYNC_FLUSH;
const LZMA_FULL_FLUSH = LZMAAction.FULL_FLUSH;
const LZMA_FINISH = LZMAAction.FINISH;
const LZMA_OK = LZMAStatus.OK;
const LZMA_STREAM_END = LZMAStatus.STREAM_END;
const LZMA_NO_CHECK = LZMAStatus.NO_CHECK;
const LZMA_UNSUPPORTED_CHECK = LZMAStatus.UNSUPPORTED_CHECK;
const LZMA_GET_CHECK = LZMAStatus.GET_CHECK;
const LZMA_MEM_ERROR = LZMAStatus.MEM_ERROR;
const LZMA_MEMLIMIT_ERROR = LZMAStatus.MEMLIMIT_ERROR;
const LZMA_FORMAT_ERROR = LZMAStatus.FORMAT_ERROR;
const LZMA_OPTIONS_ERROR = LZMAStatus.OPTIONS_ERROR;
const LZMA_DATA_ERROR = LZMAStatus.DATA_ERROR;
const LZMA_BUF_ERROR = LZMAStatus.BUF_ERROR;
const LZMA_PROG_ERROR = LZMAStatus.PROG_ERROR;
const LZMA_FILTER_X86 = LZMAFilter.X86_ALT;
const LZMA_FILTER_POWERPC = LZMAFilter.POWERPC_ALT;
const LZMA_FILTER_IA64 = LZMAFilter.IA64_ALT;
const LZMA_FILTER_ARM = LZMAFilter.ARM_ALT;
const LZMA_FILTER_ARMTHUMB = LZMAFilter.ARMTHUMB_ALT;
const LZMA_FILTERS_MAX = LZMAFilter.FILTERS_MAX;
class XzStream extends Transform {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Constructor needs complex validation for LZMA options
  constructor(streamMode, opts = {}, options) {
    super(options);
    let clonedFilters;
    if (opts.filters) {
      if (!Array.isArray(opts.filters)) {
        throw new Error("Filters need to be in an array!");
      }
      try {
        clonedFilters = [...opts.filters];
      } catch (_error) {
        throw new Error("Filters need to be in an array!");
      }
    } else {
      clonedFilters = [filter.LZMA2];
    }
    this._opts = {
      check: opts.check ?? check.NONE,
      preset: opts.preset ?? preset.DEFAULT,
      filters: clonedFilters,
      mode: opts.mode ?? mode.NORMAL,
      threads: opts.threads ?? 1,
      chunkSize: opts.chunkSize ?? liblzma.BUFSIZ,
      flushFlag: opts.flushFlag ?? liblzma.LZMA_RUN
    };
    this._chunkSize = this._opts.chunkSize;
    this._flushFlag = this._opts.flushFlag;
    require$$0.ok(Array.isArray(this._opts.filters), "Filters need to be in an array!");
    if (this._opts.filters.indexOf(filter.LZMA2) === -1) {
      this._opts.filters.push(filter.LZMA2);
    }
    const lzma2Index = this._opts.filters.indexOf(filter.LZMA2);
    if (lzma2Index !== -1 && lzma2Index !== this._opts.filters.length - 1) {
      this._opts.filters.splice(lzma2Index, 1);
      this._opts.filters.push(filter.LZMA2);
    }
    if (streamMode === liblzma.STREAM_ENCODE) {
      if (!liblzma.HAS_THREADS_SUPPORT) {
        this._opts.threads = 1;
      }
      if (this._opts.threads === 0) {
        this._opts.threads = maxThreads;
      }
    }
    this.lzma = new liblzma.LZMA(streamMode, this._opts);
    this._closed = false;
    this._hadError = false;
    this._offset = 0;
    this._buffer = Buffer.alloc(this._chunkSize);
    this._bytesRead = 0;
    this._bytesWritten = 0;
    this.on("onerror", (errno) => {
      this._hadError = true;
      const error = this._createLZMAError(errno);
      this.emit("error", error);
    });
    this.once("end", () => this.close());
  }
  _createLZMAError(errno) {
    return createLZMAError(errno);
  }
  /** Get total bytes read from input so far */
  get bytesRead() {
    return this._bytesRead;
  }
  /** Get total bytes written to output so far */
  get bytesWritten() {
    return this._bytesWritten;
  }
  /**
   * Emit a progress event with current bytesRead and bytesWritten
   */
  _emitProgress() {
    const info = {
      bytesRead: this._bytesRead,
      bytesWritten: this._bytesWritten
    };
    this.emit("progress", info);
  }
  _reallocateBuffer() {
    this._offset = 0;
    this._buffer = Buffer.alloc(this._chunkSize);
  }
  flush(kindOrCallback, callback) {
    const ws = this._writableState;
    let kind;
    let cb;
    if (typeof kindOrCallback === "function" || typeof kindOrCallback === "undefined" && !callback) {
      cb = kindOrCallback;
      kind = liblzma.LZMA_SYNC_FLUSH;
    } else {
      kind = kindOrCallback;
      cb = callback;
    }
    if (ws.ended) {
      if (cb) {
        process.nextTick(cb);
      }
    } else if (ws.ending) {
      if (cb) {
        this.once("end", cb);
      }
    } else if (ws.needDrain) {
      this.once("drain", () => {
        this.flush(cb);
      });
    } else {
      this._flushFlag = kind;
      this.write(Buffer.alloc(0), "utf8", cb);
    }
  }
  close(callback) {
    if (callback) {
      process.nextTick(callback);
    }
    if (this._closed) {
      return;
    }
    this.lzma.close();
    this._closed = true;
    process.nextTick(() => {
      this.emit("close");
    });
  }
  /* v8 ignore next */
  _transform(chunk, _encoding, callback) {
    const ws = this._writableState;
    const ending = ws.ending || ws.ended;
    const last = ending && (!chunk || ws.length === chunk.length);
    if (chunk !== null && !(chunk instanceof Buffer)) {
      callback(new Error("invalid input"));
      return;
    }
    if (this._closed) {
      callback(new Error("lzma binding closed"));
      return;
    }
    if (chunk) {
      this._bytesRead += chunk.length;
    }
    let flushFlag;
    if (last) {
      flushFlag = liblzma.LZMA_FINISH;
    } else {
      flushFlag = this._flushFlag;
      if (chunk && chunk.length >= ws.length) {
        this._flushFlag = this._opts.flushFlag;
      }
    }
    this._processChunk(chunk, flushFlag, callback);
  }
  _flush(callback) {
    if (this._closed) {
      process.nextTick(() => callback());
      return;
    }
    this._transform(Buffer.alloc(0), "utf8", callback);
  }
  _processChunk(chunk, flushFlag, cb) {
    const async = typeof cb === "function";
    require$$0.ok(!this._closed, "Stream closed!");
    let availInBefore = chunk?.length;
    let availOutBefore = this._chunkSize - this._offset;
    let inOff = 0;
    if (!async) {
      const buffers = [];
      let nread = 0;
      let error = null;
      const callback2 = (errno, availInAfter, availOutAfter) => {
        if (this._hadError) {
          return false;
        }
        if (errno !== liblzma.LZMA_OK && errno !== liblzma.LZMA_STREAM_END) {
          this.emit("onerror", errno);
          return false;
        }
        const used = availOutBefore - availOutAfter;
        require$$0.ok(used >= 0, `More bytes after than before! Delta = ${used}`);
        if (used > 0) {
          const out = this._buffer.subarray(this._offset, this._offset + used);
          this._offset += used;
          buffers.push(out);
          nread += used;
        }
        if (availOutAfter === 0 || this._offset >= this._chunkSize) {
          availOutBefore = this._chunkSize;
          this._reallocateBuffer();
        }
        if (availOutAfter === 0 || availInAfter > 0) {
          inOff += (availInBefore ?? 0) - availInAfter;
          availInBefore = availInAfter;
          return true;
        }
        return false;
      };
      this.on("error", (e) => {
        error = e;
      });
      while (true) {
        const [status, availInAfter, availOutAfter] = this.lzma.codeSync(flushFlag, chunk, inOff, availInBefore, this._buffer, this._offset);
        if (this._hadError || !callback2(status, availInAfter, availOutAfter)) {
          break;
        }
      }
      try {
        if (this._hadError) {
          throw error ?? new Error("Unknown LZMA error");
        }
        const buf = Buffer.concat(buffers, nread);
        return buf;
      } finally {
        this.close();
      }
    }
    const callback = (errno, availInAfter, availOutAfter) => {
      if (this._hadError) {
        return false;
      }
      if (errno !== liblzma.LZMA_OK && errno !== liblzma.LZMA_STREAM_END) {
        this.emit("onerror", errno);
        return false;
      }
      const used = availOutBefore - availOutAfter;
      require$$0.ok(used >= 0, `More bytes after than before! Delta = ${used}`);
      if (used > 0) {
        const out = this._buffer.subarray(this._offset, this._offset + used);
        this._offset += used;
        this._bytesWritten += used;
        this.push(out);
        this._emitProgress();
      }
      if (availOutAfter === 0 || this._offset >= this._chunkSize) {
        availOutBefore = this._chunkSize;
        this._reallocateBuffer();
      }
      if (availOutAfter === 0 || availInAfter > 0) {
        inOff += (availInBefore ?? 0) - availInAfter;
        availInBefore = availInAfter;
        this.lzma.code(flushFlag, chunk, inOff, availInBefore, this._buffer, this._offset, callback);
        return false;
      }
      if (cb && !this._closed) {
        try {
          cb();
        } catch (_error) {
          this.emit("onerror", liblzma.LZMA_PROG_ERROR);
        }
      }
      return false;
    };
    this.lzma.code(flushFlag, chunk, inOff, availInBefore, this._buffer, this._offset, callback);
    return void 0;
  }
}
class Xz extends XzStream {
  constructor(lzmaOptions, options) {
    super(liblzma.STREAM_ENCODE, lzmaOptions, options);
  }
}
class Unxz extends XzStream {
  constructor(lzmaOptions, options) {
    super(liblzma.STREAM_DECODE, lzmaOptions, options);
  }
}
function createXz(lzmaOptions, options) {
  return new Xz(lzmaOptions, options);
}
function createUnxz(lzmaOptions, options) {
  return new Unxz(lzmaOptions, options);
}
function hasThreads() {
  return liblzma.HAS_THREADS_SUPPORT;
}
function isXZ(buffer) {
  return liblzma.isXZ(buffer);
}
function versionString() {
  return liblzma.versionString();
}
function versionNumber() {
  return liblzma.versionNumber();
}
function easyEncoderMemusage(presetLevel) {
  return liblzma.easyEncoderMemusage(presetLevel);
}
function easyDecoderMemusage() {
  return liblzma.easyDecoderMemusage();
}
function parseFileIndex(buffer) {
  return liblzma.parseFileIndex(buffer);
}
var LZMAErrorMessage;
(function(LZMAErrorMessage2) {
  LZMAErrorMessage2["SUCCESS"] = "Operation completed successfully";
  LZMAErrorMessage2["STREAM_END"] = "End of stream was reached";
  LZMAErrorMessage2["NO_CHECK"] = "Input stream has no integrity check";
  LZMAErrorMessage2["UNSUPPORTED_CHECK"] = "Cannot calculate the integrity check";
  LZMAErrorMessage2["GET_CHECK"] = "Integrity check type is not available";
  LZMAErrorMessage2["MEM_ERROR"] = "Cannot allocate memory";
  LZMAErrorMessage2["MEMLIMIT_ERROR"] = "Memory usage limit was reached";
  LZMAErrorMessage2["FORMAT_ERROR"] = "File format not recognized";
  LZMAErrorMessage2["OPTIONS_ERROR"] = "Invalid or unsupported options";
  LZMAErrorMessage2["DATA_ERROR"] = "Data is corrupt";
  LZMAErrorMessage2["BUF_ERROR"] = "No progress is possible";
  LZMAErrorMessage2["PROG_ERROR"] = "Programming error";
})(LZMAErrorMessage || (LZMAErrorMessage = {}));
const messages = [
  LZMAErrorMessage.SUCCESS,
  LZMAErrorMessage.STREAM_END,
  LZMAErrorMessage.NO_CHECK,
  LZMAErrorMessage.UNSUPPORTED_CHECK,
  LZMAErrorMessage.GET_CHECK,
  LZMAErrorMessage.MEM_ERROR,
  LZMAErrorMessage.MEMLIMIT_ERROR,
  LZMAErrorMessage.FORMAT_ERROR,
  LZMAErrorMessage.OPTIONS_ERROR,
  LZMAErrorMessage.DATA_ERROR,
  LZMAErrorMessage.BUF_ERROR,
  LZMAErrorMessage.PROG_ERROR
];
function unxz(buffer, optsOrCallback, callback) {
  let opts;
  let cb;
  if (typeof optsOrCallback === "function") {
    cb = optsOrCallback;
    opts = {};
  } else {
    opts = optsOrCallback;
    cb = callback;
  }
  xzBuffer(new Unxz(opts), buffer, cb);
}
function unxzSync(buffer, opts) {
  return xzBufferSync(new Unxz(opts), buffer);
}
function xz(buffer, optsOrCallback, callback) {
  let opts;
  let cb;
  if (typeof optsOrCallback === "function") {
    cb = optsOrCallback;
    opts = {};
  } else {
    opts = optsOrCallback;
    cb = callback;
  }
  xzBuffer(new Xz(opts), buffer, cb);
}
function xzSync(buffer, opts) {
  return xzBufferSync(new Xz(opts), buffer);
}
function xzAsync(buffer, opts) {
  return new Promise((resolve, reject) => {
    xz(buffer, opts || {}, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function unxzAsync(buffer, opts) {
  return new Promise((resolve, reject) => {
    unxz(buffer, opts || {}, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function xzBuffer(engine, buffer, callback) {
  const buffers = [];
  let nread = 0;
  const flow = () => {
    let chunk;
    while ((chunk = engine.read()) !== null) {
      buffers.push(chunk);
      nread += chunk.length;
    }
    engine.once("readable", flow);
  };
  const onEnd = () => {
    const buf = Buffer.concat(buffers, nread);
    callback(null, buf);
    engine.close();
  };
  const onError = (err) => {
    engine.removeListener("end", onEnd);
    engine.removeListener("readable", flow);
    callback(err);
  };
  engine.on("error", onError);
  engine.on("end", onEnd);
  engine.end(buffer);
  flow();
}
function xzBufferSync(engine, buffer) {
  let buf;
  if (typeof buffer === "string") {
    buf = Buffer.from(buffer);
  } else if (buffer instanceof Buffer) {
    buf = buffer;
  } else {
    throw new TypeError("Not a string or buffer");
  }
  return engine._processChunk(buf, liblzma.LZMA_FINISH);
}
async function xzFile(inputPath, outputPath, opts) {
  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);
  const compressor = createXz(opts);
  await pipeline(input, compressor, output);
}
async function unxzFile(inputPath, outputPath, opts) {
  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);
  const decompressor = createUnxz(opts);
  await pipeline(input, decompressor, output);
}
const lzma = {
  Xz,
  Unxz,
  XzStream,
  hasThreads,
  messages,
  check,
  preset,
  flag,
  filter,
  mode,
  createXz,
  createUnxz,
  unxz,
  unxzSync,
  xz,
  xzSync,
  xzAsync,
  unxzAsync,
  // Reference individual exports to avoid duplication
  LZMA_RUN,
  LZMA_SYNC_FLUSH,
  LZMA_FULL_FLUSH,
  LZMA_FINISH,
  LZMA_OK,
  LZMA_STREAM_END,
  LZMA_NO_CHECK,
  LZMA_UNSUPPORTED_CHECK,
  LZMA_GET_CHECK,
  LZMA_MEM_ERROR,
  LZMA_MEMLIMIT_ERROR,
  LZMA_FORMAT_ERROR,
  LZMA_OPTIONS_ERROR,
  LZMA_DATA_ERROR,
  LZMA_BUF_ERROR,
  LZMA_PROG_ERROR,
  LZMA_FILTER_X86,
  LZMA_FILTER_POWERPC,
  LZMA_FILTER_IA64,
  LZMA_FILTER_ARM,
  LZMA_FILTER_ARMTHUMB,
  LZMA_FILTERS_MAX
};
export {
  LZMAAction,
  LZMABufferError,
  LZMADataError,
  LZMAError,
  LZMAErrorMessage,
  LZMAFilter,
  LZMAFormatError,
  LZMAMemoryError,
  LZMAMemoryLimitError,
  LZMAOptionsError,
  LZMAPool,
  LZMAProgrammingError,
  LZMAStatus,
  LZMA_BUF_ERROR,
  LZMA_DATA_ERROR,
  LZMA_FILTERS_MAX,
  LZMA_FILTER_ARM,
  LZMA_FILTER_ARMTHUMB,
  LZMA_FILTER_IA64,
  LZMA_FILTER_POWERPC,
  LZMA_FILTER_X86,
  LZMA_FINISH,
  LZMA_FORMAT_ERROR,
  LZMA_FULL_FLUSH,
  LZMA_GET_CHECK,
  LZMA_MEMLIMIT_ERROR,
  LZMA_MEM_ERROR,
  LZMA_NO_CHECK,
  LZMA_OK,
  LZMA_OPTIONS_ERROR,
  LZMA_PROG_ERROR,
  LZMA_RUN,
  LZMA_STREAM_END,
  LZMA_SYNC_FLUSH,
  LZMA_UNSUPPORTED_CHECK,
  Unxz,
  Xz,
  XzStream,
  check,
  createUnxz,
  createXz,
  lzma as default,
  easyDecoderMemusage,
  easyEncoderMemusage,
  filter,
  flag,
  hasThreads,
  isXZ,
  messages,
  mode,
  parseFileIndex,
  preset,
  unxz,
  unxzAsync,
  unxzFile,
  unxzSync,
  versionNumber,
  versionString,
  xz,
  xzAsync,
  xzFile,
  xzSync
};
