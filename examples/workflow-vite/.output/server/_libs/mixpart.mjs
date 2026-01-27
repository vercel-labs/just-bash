var MultipartParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "MultipartParseError";
  }
};
function createSearch(pattern) {
  const needle = new TextEncoder().encode(pattern);
  return (haystack, start = 0) => Buffer.prototype.indexOf.call(haystack, needle, start);
}
function createPartialTailSearch(pattern) {
  const needle = new TextEncoder().encode(pattern);
  const byteIndexes = {};
  for (let i = 0; i < needle.length; ++i) {
    const byte = needle[i];
    if (byteIndexes[byte] === void 0) byteIndexes[byte] = [];
    byteIndexes[byte].push(i);
  }
  return function(haystack) {
    const haystackEnd = haystack.length - 1;
    if (haystack[haystackEnd] in byteIndexes) {
      const indexes = byteIndexes[haystack[haystackEnd]];
      for (let i = indexes.length - 1; i >= 0; --i) {
        for (let j = indexes[i], k = haystackEnd; j >= 0 && haystack[k] === needle[j]; --j, --k) {
          if (j === 0) return k;
        }
      }
    }
    return -1;
  };
}
function parseHeaders(headerBytes) {
  const headerText = new TextDecoder("iso-8859-1").decode(headerBytes);
  const lines = headerText.trim().split(/\r?\n/);
  const headerInit = [];
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const name = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      headerInit.push([name, value]);
    }
  }
  return new Headers(headerInit);
}
function extractBoundary(contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new MultipartParseError("No boundary found in Content-Type header");
  }
  return boundaryMatch[1] ?? boundaryMatch[2];
}
var AsyncMessageQueue = class {
  queue = [];
  waiters = [];
  finished = false;
  cancelled = false;
  error = null;
  /**
   * Producer: Enqueue a message for consumption
   */
  enqueue(message) {
    if (this.finished || this.cancelled) return;
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.resolve(message);
    } else {
      this.queue.push(message);
    }
  }
  /**
   * Producer: Signal completion (with optional error)
   */
  finish(error) {
    if (this.finished) return;
    this.finished = true;
    this.error = error || null;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(null);
      }
    }
  }
  /**
   * Consumer: Cancel the queue (stops accepting new messages and notifies waiters)
   */
  cancel() {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter.resolve(null);
    }
  }
  /**
   * Consumer: Dequeue next message (or null if finished/cancelled)
   */
  async dequeue() {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    if (this.finished || this.cancelled) {
      if (this.error) throw this.error;
      return null;
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
  /**
   * Check if the queue is in a terminal state
   */
  get isTerminal() {
    return this.finished || this.cancelled;
  }
};
async function* parseMultipartStream(response, options) {
  if (!response.body) {
    throw new MultipartParseError("Response body is null");
  }
  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new MultipartParseError("Missing Content-Type header");
  }
  const boundary = extractBoundary(contentType);
  const parser = new StreamingMultipartParser(boundary, options);
  yield* parser.parseStream(response.body);
}
var StreamingMultipartParser = class {
  boundary;
  findOpeningBoundary;
  openingBoundaryLength;
  findBoundary;
  findPartialTailBoundary;
  boundaryLength;
  findDoubleNewline;
  // Safety limits
  maxHeaderSize;
  maxBoundaryBuffer;
  state = 0;
  buffer = null;
  currentHeaders = new Headers();
  currentPayloadController = null;
  constructor(boundary, options = {}) {
    this.boundary = boundary;
    this.findOpeningBoundary = createSearch(`--${boundary}`);
    this.openingBoundaryLength = 2 + boundary.length;
    this.findBoundary = createSearch(`\r
--${boundary}`);
    this.findPartialTailBoundary = createPartialTailSearch(`\r
--${boundary}`);
    this.boundaryLength = 4 + boundary.length;
    this.findDoubleNewline = createSearch("\r\n\r\n");
    this.maxHeaderSize = options.maxHeaderSize ?? 65536;
    this.maxBoundaryBuffer = options.maxBoundaryBuffer ?? 8192;
  }
  async *parseStream(stream) {
    const reader = stream.getReader();
    const messageQueue = new AsyncMessageQueue();
    const producer = this.startProducer(reader, messageQueue);
    try {
      yield* this.consumeMessages(messageQueue);
    } finally {
      messageQueue.cancel();
      this.closeCurrentPayload();
      try {
        await reader.cancel();
      } catch (error) {
      }
      await producer;
    }
  }
  /**
   * Producer: Continuously read chunks and parse messages
   */
  async startProducer(reader, messageQueue) {
    try {
      while (!messageQueue.isTerminal) {
        let result;
        try {
          result = await reader.read();
        } catch (readError) {
          if (readError instanceof Error && (readError.name === "AbortError" || readError.constructor.name === "AbortError" || readError.name === "TimeoutError" || readError.constructor.name === "TimeoutError")) {
            break;
          }
          throw readError;
        }
        const { done, value } = result;
        if (done) {
          if (this.buffer !== null && this.buffer.length > 0) {
            const messages2 = this.write(new Uint8Array(0));
            for (const message of messages2) {
              if (messageQueue.isTerminal) break;
              messageQueue.enqueue(message);
            }
          }
          if (this.state !== 4) {
            if (this.state === 0) {
              throw new MultipartParseError(
                "Invalid multipart stream: missing initial boundary"
              );
            }
            throw new MultipartParseError("Unexpected end of stream");
          }
          break;
        }
        if (!(value instanceof Uint8Array)) {
          throw new MultipartParseError(
            `Invalid chunk type: expected Uint8Array, got ${typeof value}`
          );
        }
        const messages = this.write(value);
        for (const message of messages) {
          if (messageQueue.isTerminal) break;
          messageQueue.enqueue(message);
        }
      }
      if (!messageQueue.isTerminal) {
        messageQueue.finish();
      }
    } catch (error) {
      this.closeCurrentPayload(error);
      if (!messageQueue.isTerminal) {
        messageQueue.finish(error);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (error) {
      }
    }
  }
  /**
   * Consumer: Yield messages from the queue
   */
  async *consumeMessages(messageQueue) {
    while (true) {
      const message = await messageQueue.dequeue();
      if (message === null) {
        break;
      }
      yield message;
    }
  }
  /**
   * Process a chunk of data through the state machine and return any complete messages.
   *
   * Returns an array because a single chunk can contain multiple complete messages
   * when small messages with headers + body + boundary all fit in one network chunk.
   * All messages must be captured and queued to maintain proper message ordering.
   */
  write(chunk) {
    const newMessages = [];
    if (this.state === 4) {
      throw new MultipartParseError("Unexpected data after end of stream");
    }
    let index = 0;
    let chunkLength = chunk.length;
    if (this.buffer !== null) {
      const newSize = this.buffer.length + chunkLength;
      const maxAllowedSize = this.state === 2 ? this.maxHeaderSize : this.maxBoundaryBuffer;
      if (newSize > maxAllowedSize) {
        throw new MultipartParseError(
          `Buffer size limit exceeded: ${newSize} bytes > ${maxAllowedSize} bytes. This may indicate malformed multipart data with ${this.state === 2 ? "oversized headers" : "invalid boundaries"}.`
        );
      }
      const newChunk = new Uint8Array(newSize);
      newChunk.set(this.buffer, 0);
      newChunk.set(chunk, this.buffer.length);
      chunk = newChunk;
      chunkLength = chunk.length;
      this.buffer = null;
    }
    if (chunkLength === 0 && this.state === 0) {
      throw new MultipartParseError(
        "Invalid multipart stream: missing initial boundary"
      );
    }
    while (true) {
      if (this.state === 3) {
        if (chunkLength - index < this.boundaryLength) {
          const remainingData = chunk.subarray(index);
          if (remainingData.length > this.maxBoundaryBuffer) {
            throw new MultipartParseError(
              `Boundary buffer limit exceeded: ${remainingData.length} > ${this.maxBoundaryBuffer}`
            );
          }
          this.buffer = remainingData;
          break;
        }
        const boundaryIndex = this.findBoundary(chunk, index);
        if (boundaryIndex === -1) {
          const partialTailIndex = this.findPartialTailBoundary(chunk);
          if (partialTailIndex === -1) {
            this.writeBody(index === 0 ? chunk : chunk.subarray(index));
          } else {
            this.writeBody(chunk.subarray(index, partialTailIndex));
            const partialBoundary = chunk.subarray(partialTailIndex);
            if (partialBoundary.length > this.maxBoundaryBuffer) {
              throw new MultipartParseError(
                `Partial boundary too large: ${partialBoundary.length} > ${this.maxBoundaryBuffer}`
              );
            }
            this.buffer = partialBoundary;
          }
          break;
        }
        this.writeBody(chunk.subarray(index, boundaryIndex));
        this.finishMessage();
        index = boundaryIndex + this.boundaryLength;
        this.state = 1;
      }
      if (this.state === 1) {
        if (chunkLength - index < 2) {
          const remainingData = chunk.subarray(index);
          if (remainingData.length > this.maxBoundaryBuffer) {
            throw new MultipartParseError(
              `After-boundary buffer limit exceeded: ${remainingData.length} > ${this.maxBoundaryBuffer}`
            );
          }
          this.buffer = remainingData;
          break;
        }
        if (chunk[index] === 45 && chunk[index + 1] === 45) {
          this.state = 4;
          break;
        }
        if (chunk[index] === 13 && chunk[index + 1] === 10) {
          index += 2;
        } else if (chunk[index] === 10) {
          index += 1;
        } else {
          throw new MultipartParseError(
            `Invalid character after boundary: expected CRLF or LF, got 0x${chunk[index].toString(16)}`
          );
        }
        this.state = 2;
      }
      if (this.state === 2) {
        if (chunkLength - index < 4) {
          const remainingData = chunk.subarray(index);
          if (remainingData.length > this.maxHeaderSize) {
            throw new MultipartParseError(
              `Header buffer limit exceeded: ${remainingData.length} > ${this.maxHeaderSize}`
            );
          }
          this.buffer = remainingData;
          break;
        }
        let headerEndIndex = this.findDoubleNewline(chunk, index);
        let headerEndOffset = 4;
        if (headerEndIndex === -1) {
          const lfDoubleNewline = createSearch("\n\n");
          headerEndIndex = lfDoubleNewline(chunk, index);
          headerEndOffset = 2;
        }
        if (headerEndIndex === -1) {
          const headerData = chunk.subarray(index);
          if (headerData.length > this.maxHeaderSize) {
            throw new MultipartParseError(
              `Headers too large: ${headerData.length} > ${this.maxHeaderSize} bytes`
            );
          }
          this.buffer = headerData;
          break;
        }
        const headerBytes = chunk.subarray(index, headerEndIndex);
        this.currentHeaders = parseHeaders(headerBytes);
        const message = this.createStreamingMessage();
        newMessages.push(message);
        index = headerEndIndex + headerEndOffset;
        this.state = 3;
        continue;
      }
      if (this.state === 0) {
        if (chunkLength < this.openingBoundaryLength) {
          if (chunk.length > this.maxBoundaryBuffer) {
            throw new MultipartParseError(
              `Initial chunk too large for boundary detection: ${chunk.length} > ${this.maxBoundaryBuffer}`
            );
          }
          this.buffer = chunk;
          break;
        }
        const boundaryIndex = this.findOpeningBoundary(chunk);
        if (boundaryIndex !== 0) {
          throw new MultipartParseError(
            "Invalid multipart stream: missing initial boundary"
          );
        }
        index = this.openingBoundaryLength;
        this.state = 1;
      }
    }
    return newMessages;
  }
  createStreamingMessage() {
    const headers = new Headers(this.currentHeaders);
    const payload = new ReadableStream({
      start: (controller) => {
        this.currentPayloadController = controller;
      }
    });
    this.currentHeaders = new Headers();
    return {
      headers,
      payload
    };
  }
  writeBody(chunk) {
    if (this.currentPayloadController) {
      this.currentPayloadController.enqueue(chunk);
    }
  }
  finishMessage() {
    if (this.currentPayloadController) {
      this.currentPayloadController.close();
      this.currentPayloadController = null;
    }
  }
  /**
   * Close current payload controller if open (used during cleanup)
   * If an error is provided, forwards it to the payload consumer
   */
  closeCurrentPayload(error) {
    if (this.currentPayloadController) {
      try {
        if (error) {
          this.currentPayloadController.error(error);
        } else {
          this.currentPayloadController.close();
        }
      } catch (controllerError) {
      }
      this.currentPayloadController = null;
    }
  }
};
export {
  parseMultipartStream as p
};
