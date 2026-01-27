import crypto from "node:crypto";
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = 32;
const RANDOM_LEN = 16;
const TIME_LEN = 10;
const TIME_MAX = 281474976710655;
var ULIDErrorCode;
(function(ULIDErrorCode2) {
  ULIDErrorCode2["Base32IncorrectEncoding"] = "B32_ENC_INVALID";
  ULIDErrorCode2["DecodeTimeInvalidCharacter"] = "DEC_TIME_CHAR";
  ULIDErrorCode2["DecodeTimeValueMalformed"] = "DEC_TIME_MALFORMED";
  ULIDErrorCode2["EncodeTimeNegative"] = "ENC_TIME_NEG";
  ULIDErrorCode2["EncodeTimeSizeExceeded"] = "ENC_TIME_SIZE_EXCEED";
  ULIDErrorCode2["EncodeTimeValueMalformed"] = "ENC_TIME_MALFORMED";
  ULIDErrorCode2["PRNGDetectFailure"] = "PRNG_DETECT";
  ULIDErrorCode2["ULIDInvalid"] = "ULID_INVALID";
  ULIDErrorCode2["Unexpected"] = "UNEXPECTED";
  ULIDErrorCode2["UUIDInvalid"] = "UUID_INVALID";
})(ULIDErrorCode || (ULIDErrorCode = {}));
class ULIDError extends Error {
  constructor(errorCode, message) {
    super(`${message} (${errorCode})`);
    this.name = "ULIDError";
    this.code = errorCode;
  }
}
function randomChar(prng) {
  const randomPosition = Math.floor(prng() * ENCODING_LEN) % ENCODING_LEN;
  return ENCODING.charAt(randomPosition);
}
function replaceCharAt(str, index, char) {
  if (index > str.length - 1) {
    return str;
  }
  return str.substr(0, index) + char + str.substr(index + 1);
}
function incrementBase32(str) {
  let done = void 0, index = str.length, char, charIndex, output = str;
  const maxCharIndex = ENCODING_LEN - 1;
  while (!done && index-- >= 0) {
    char = output[index];
    charIndex = ENCODING.indexOf(char);
    if (charIndex === -1) {
      throw new ULIDError(ULIDErrorCode.Base32IncorrectEncoding, "Incorrectly encoded string");
    }
    if (charIndex === maxCharIndex) {
      output = replaceCharAt(output, index, ENCODING[0]);
      continue;
    }
    done = replaceCharAt(output, index, ENCODING[charIndex + 1]);
  }
  if (typeof done === "string") {
    return done;
  }
  throw new ULIDError(ULIDErrorCode.Base32IncorrectEncoding, "Failed incrementing string");
}
function decodeTime(id) {
  if (id.length !== TIME_LEN + RANDOM_LEN) {
    throw new ULIDError(ULIDErrorCode.DecodeTimeValueMalformed, "Malformed ULID");
  }
  const time = id.substr(0, TIME_LEN).toUpperCase().split("").reverse().reduce((carry, char, index) => {
    const encodingIndex = ENCODING.indexOf(char);
    if (encodingIndex === -1) {
      throw new ULIDError(ULIDErrorCode.DecodeTimeInvalidCharacter, `Time decode error: Invalid character: ${char}`);
    }
    return carry += encodingIndex * Math.pow(ENCODING_LEN, index);
  }, 0);
  if (time > TIME_MAX) {
    throw new ULIDError(ULIDErrorCode.DecodeTimeValueMalformed, `Malformed ULID: timestamp too large: ${time}`);
  }
  return time;
}
function detectPRNG(root) {
  const rootLookup = detectRoot();
  const globalCrypto = rootLookup && (rootLookup.crypto || rootLookup.msCrypto) || (typeof crypto !== "undefined" ? crypto : null);
  if (typeof globalCrypto?.getRandomValues === "function") {
    return () => {
      const buffer = new Uint8Array(1);
      globalCrypto.getRandomValues(buffer);
      return buffer[0] / 255;
    };
  } else if (typeof globalCrypto?.randomBytes === "function") {
    return () => globalCrypto.randomBytes(1).readUInt8() / 255;
  } else if (crypto?.randomBytes) {
    return () => crypto.randomBytes(1).readUInt8() / 255;
  }
  throw new ULIDError(ULIDErrorCode.PRNGDetectFailure, "Failed to find a reliable PRNG");
}
function detectRoot() {
  if (inWebWorker())
    return self;
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  return null;
}
function encodeRandom(len, prng) {
  let str = "";
  for (; len > 0; len--) {
    str = randomChar(prng) + str;
  }
  return str;
}
function encodeTime(now, len = TIME_LEN) {
  if (isNaN(now)) {
    throw new ULIDError(ULIDErrorCode.EncodeTimeValueMalformed, `Time must be a number: ${now}`);
  } else if (now > TIME_MAX) {
    throw new ULIDError(ULIDErrorCode.EncodeTimeSizeExceeded, `Cannot encode a time larger than ${TIME_MAX}: ${now}`);
  } else if (now < 0) {
    throw new ULIDError(ULIDErrorCode.EncodeTimeNegative, `Time must be positive: ${now}`);
  } else if (Number.isInteger(now) === false) {
    throw new ULIDError(ULIDErrorCode.EncodeTimeValueMalformed, `Time must be an integer: ${now}`);
  }
  let mod, str = "";
  for (let currentLen = len; currentLen > 0; currentLen--) {
    mod = now % ENCODING_LEN;
    str = ENCODING.charAt(mod) + str;
    now = (now - mod) / ENCODING_LEN;
  }
  return str;
}
function inWebWorker() {
  return typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
}
function monotonicFactory(prng) {
  const currentPRNG = prng || detectPRNG();
  let lastTime = 0, lastRandom;
  return function _ulid(seedTime) {
    const seed = !seedTime || isNaN(seedTime) ? Date.now() : seedTime;
    if (seed <= lastTime) {
      const incrementedRandom = lastRandom = incrementBase32(lastRandom);
      return encodeTime(lastTime, TIME_LEN) + incrementedRandom;
    }
    lastTime = seed;
    const newRandom = lastRandom = encodeRandom(RANDOM_LEN, currentPRNG);
    return encodeTime(seed, TIME_LEN) + newRandom;
  };
}
export {
  decodeTime as d,
  monotonicFactory as m
};
