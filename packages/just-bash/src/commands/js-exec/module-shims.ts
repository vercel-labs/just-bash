/**
 * Node.js module shims for the QuickJS sandbox.
 * Each is a JS source string evaluated inside the sandbox IIFE.
 * They set up globals (e.g. globalThis[Symbol.for('jb:os')]) referenced by both
 * require() and ESM VIRTUAL_MODULES.
 */

/** EventEmitter — pure JS, no dependencies. Must run before stream. */
export const EVENTS_MODULE_SOURCE = `
var EventEmitter = (function() {
  function EE() {
    this._events = {};
    this._maxListeners = 10;
  }
  EE.prototype.on = function(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  };
  EE.prototype.addListener = EE.prototype.on;
  EE.prototype.once = function(event, listener) {
    var self = this;
    function wrapper() {
      self.removeListener(event, wrapper);
      listener.apply(this, arguments);
    }
    wrapper._original = listener;
    return this.on(event, wrapper);
  };
  EE.prototype.off = function(event, listener) {
    return this.removeListener(event, listener);
  };
  EE.prototype.removeListener = function(event, listener) {
    var list = this._events[event];
    if (list) {
      this._events[event] = list.filter(function(fn) {
        return fn !== listener && fn._original !== listener;
      });
    }
    return this;
  };
  EE.prototype.removeAllListeners = function(event) {
    if (event) delete this._events[event];
    else this._events = {};
    return this;
  };
  EE.prototype.emit = function(event) {
    var list = this._events[event];
    if (!list || list.length === 0) return false;
    var args = Array.prototype.slice.call(arguments, 1);
    var fns = list.slice();
    for (var i = 0; i < fns.length; i++) fns[i].apply(this, args);
    return true;
  };
  EE.prototype.listeners = function(event) {
    return (this._events[event] || []).slice();
  };
  EE.prototype.listenerCount = function(event) {
    return (this._events[event] || []).length;
  };
  EE.prototype.setMaxListeners = function(n) {
    this._maxListeners = n;
    return this;
  };
  EE.prototype.eventNames = function() {
    return Object.keys(this._events);
  };
  EE.prototype.prependListener = function(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].unshift(listener);
    return this;
  };
  return EE;
})();
globalThis[Symbol.for('jb:events')] = { EventEmitter: EventEmitter };
`;

/** OS module — hardcoded sandbox values */
export const OS_MODULE_SOURCE = `
var _os = {
  platform: function() { return globalThis.process.platform; },
  arch: function() { return globalThis.process.arch; },
  homedir: function() { return '/home/user'; },
  tmpdir: function() { return '/tmp'; },
  type: function() { return 'Linux'; },
  hostname: function() { return 'sandbox'; },
  EOL: '\\n',
  cpus: function() { return []; },
  totalmem: function() { return 0; },
  freemem: function() { return 0; },
  endianness: function() { return 'LE'; }
};
globalThis[Symbol.for('jb:os')] = _os;
`;

/** URL module — wraps globalThis.URL/URLSearchParams from fetch polyfill */
export const URL_MODULE_SOURCE = `
var _urlMod = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  parse: function(urlStr) {
    try {
      var u = new URL(urlStr);
      return {
        protocol: u.protocol, host: u.host, hostname: u.hostname,
        port: u.port, pathname: u.pathname, search: u.search,
        hash: u.hash, href: u.href, path: u.pathname + u.search
      };
    } catch(e) {
      return {
        protocol: null, host: null, hostname: null, port: null,
        pathname: urlStr, search: '', hash: '', href: urlStr, path: urlStr
      };
    }
  },
  format: function(obj) {
    if (typeof obj === 'string') return obj;
    if (obj instanceof URL) return obj.href;
    var auth = obj.auth ? obj.auth + '@' : '';
    var host = obj.host || ((obj.hostname || '') + (obj.port ? ':' + obj.port : ''));
    return (obj.protocol ? obj.protocol + '//' : '') + auth + host +
      (obj.pathname || '/') + (obj.search || '') + (obj.hash || '');
  }
};
globalThis[Symbol.for('jb:url')] = _urlMod;
`;

/** Assert module — pure JS */
export const ASSERT_MODULE_SOURCE = `
var _deepEqual = function(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (!_deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
};
var _assert = function(val, msg) {
  if (!val) throw new Error(msg || 'AssertionError: expected truthy value');
};
_assert.ok = _assert;
_assert.equal = function(a, b, msg) {
  if (a != b) throw new Error(msg || 'AssertionError: ' + a + ' != ' + b);
};
_assert.notEqual = function(a, b, msg) {
  if (a == b) throw new Error(msg || 'AssertionError: ' + a + ' == ' + b);
};
_assert.strictEqual = function(a, b, msg) {
  if (a !== b) throw new Error(msg || 'AssertionError: ' + a + ' !== ' + b);
};
_assert.notStrictEqual = function(a, b, msg) {
  if (a === b) throw new Error(msg || 'AssertionError: ' + a + ' === ' + b);
};
_assert.deepEqual = function(a, b, msg) {
  if (!_deepEqual(a, b)) throw new Error(msg || 'AssertionError: objects not deep equal');
};
_assert.deepStrictEqual = _assert.deepEqual;
_assert.notDeepEqual = function(a, b, msg) {
  if (_deepEqual(a, b)) throw new Error(msg || 'AssertionError: objects are deep equal');
};
_assert.throws = function(fn, expected, msg) {
  var threw = false;
  try { fn(); } catch(e) {
    threw = true;
    if (expected instanceof RegExp && !expected.test(e.message))
      throw new Error(msg || 'AssertionError: error message did not match');
  }
  if (!threw) throw new Error(msg || 'AssertionError: function did not throw');
};
_assert.doesNotThrow = function(fn, msg) {
  // @banned-pattern-ignore: sandbox-internal assertion helper; e.message is from user code inside QuickJS, not host details
  try { fn(); } catch(e) {
    throw new Error(msg || 'AssertionError: function threw: ' + e.message);
  }
};
_assert.fail = function(msg) {
  throw new Error(msg || 'AssertionError: assert.fail()');
};
globalThis[Symbol.for('jb:assert')] = _assert;
`;

/** Util module — format, inspect, promisify, types */
export const UTIL_MODULE_SOURCE = `
var _util = {
  format: function() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 0) return '';
    var fmt = args[0];
    if (typeof fmt !== 'string') {
      return args.map(function(a) {
        return typeof a === 'string' ? a : JSON.stringify(a);
      }).join(' ');
    }
    var i = 1;
    var str = fmt.replace(/%[sdjifoO%]/g, function(m) {
      if (m === '%%') return '%';
      if (i >= args.length) return m;
      var v = args[i++];
      if (m === '%s') return String(v);
      if (m === '%d') return Number(v).toString();
      if (m === '%i') { var n = Number(v); return (isNaN(n) ? 'NaN' : Math.trunc(n)).toString(); }
      if (m === '%j') return JSON.stringify(v);
      if (m === '%f') return parseFloat(v).toString();
      if (m === '%o' || m === '%O') return JSON.stringify(v);
      return m;
    });
    while (i < args.length) {
      str += ' ' + (typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i]));
      i++;
    }
    return str;
  },
  inspect: function(obj, opts) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return "'" + obj + "'";
    if (typeof obj === 'function') return '[Function: ' + (obj.name || 'anonymous') + ']';
    var seen = [];
    try {
      return JSON.stringify(obj, function(key, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.indexOf(val) !== -1) return '[Circular]';
          seen.push(val);
        }
        return val;
      });
    } catch(e) { return String(obj); }
  },
  promisify: function(fn) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function(resolve, reject) {
        args.push(function(err, val) { if (err) reject(err); else resolve(val); });
        fn.apply(null, args);
      });
    };
  },
  types: {
    isDate: function(v) { return v instanceof Date; },
    isRegExp: function(v) { return v instanceof RegExp; },
    isArray: function(v) { return Array.isArray(v); },
    isMap: function(v) { return typeof Map !== 'undefined' && v instanceof Map; },
    isSet: function(v) { return typeof Set !== 'undefined' && v instanceof Set; }
  },
  inherits: function(ctor, superCtor) {
    ctor.prototype = Object.create(superCtor.prototype);
    ctor.prototype.constructor = ctor;
  }
};
globalThis[Symbol.for('jb:util')] = _util;
`;

/** Buffer module — wraps Uint8Array, pure-JS UTF-8 (no TextEncoder/TextDecoder) */
export const BUFFER_MODULE_SOURCE = `
function _utf8Encode(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var lo = str.charCodeAt(++i);
      var cp = ((c - 0xD800) * 0x400) + (lo - 0xDC00) + 0x10000;
      bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else {
      bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return bytes;
}
function _utf8Decode(bytes) {
  var str = '';
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b < 0x80) { str += String.fromCharCode(b); i++; }
    else if ((b & 0xE0) === 0xC0) { str += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i+1] & 0x3F)); i += 2; }
    else if ((b & 0xF0) === 0xE0) { str += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i+1] & 0x3F) << 6) | (bytes[i+2] & 0x3F)); i += 3; }
    else if ((b & 0xF8) === 0xF0) { var cp = ((b & 0x07) << 18) | ((bytes[i+1] & 0x3F) << 12) | ((bytes[i+2] & 0x3F) << 6) | (bytes[i+3] & 0x3F); cp -= 0x10000; str += String.fromCharCode((cp >> 10) + 0xD800, (cp & 0x3FF) + 0xDC00); i += 4; }
    else { i++; }
  }
  return str;
}
// _utf8Encode/_utf8Decode are IIFE-local vars, available to all module shims

function Buffer(arg) {
  if (typeof arg === 'number') {
    this._data = new Uint8Array(arg);
  } else if (arg instanceof ArrayBuffer) {
    this._data = new Uint8Array(arg);
  } else if (arg instanceof Uint8Array) {
    this._data = new Uint8Array(arg);
  } else if (Array.isArray(arg)) {
    this._data = new Uint8Array(arg);
  } else {
    this._data = new Uint8Array(0);
  }
  this.length = this._data.length;
}
Buffer.from = function(data, encoding) {
  if (typeof data === 'string') {
    return new Buffer(_utf8Encode(data));
  }
  if (data instanceof ArrayBuffer) return new Buffer(data);
  if (data instanceof Uint8Array) return new Buffer(data);
  if (Array.isArray(data)) return new Buffer(data);
  if (data && data._data) return new Buffer(data._data.slice());
  return new Buffer(0);
};
Buffer.alloc = function(size, fill) {
  var buf = new Buffer(size);
  if (fill !== undefined) {
    var fillByte = typeof fill === 'number' ? fill : 0;
    buf._data.fill(fillByte);
  }
  return buf;
};
Buffer.allocUnsafe = Buffer.alloc;
Buffer.isBuffer = function(obj) { return obj instanceof Buffer; };
Buffer.concat = function(list, totalLength) {
  if (!totalLength) {
    totalLength = 0;
    for (var i = 0; i < list.length; i++) totalLength += list[i].length;
  }
  var result = new Uint8Array(totalLength);
  var offset = 0;
  for (var i = 0; i < list.length; i++) {
    result.set(list[i]._data, offset);
    offset += list[i].length;
  }
  return new Buffer(result);
};
Buffer.byteLength = function(str) {
  return _utf8Encode(str).length;
};
Buffer.prototype.toString = function(encoding) {
  return _utf8Decode(this._data);
};
Buffer.prototype.toJSON = function() {
  return { type: 'Buffer', data: Array.from(this._data) };
};
Buffer.prototype.slice = function(start, end) {
  return new Buffer(this._data.slice(start, end));
};
Buffer.prototype.copy = function(target, targetStart, sourceStart, sourceEnd) {
  targetStart = targetStart || 0;
  sourceStart = sourceStart || 0;
  sourceEnd = sourceEnd || this.length;
  var sub = this._data.subarray(sourceStart, sourceEnd);
  target._data.set(sub, targetStart);
  return sub.length;
};
Buffer.prototype.write = function(str, offset) {
  var bytes = _utf8Encode(str);
  offset = offset || 0;
  this._data.set(bytes, offset);
  return bytes.length;
};
Buffer.prototype.fill = function(val, offset, end) {
  this._data.fill(typeof val === 'number' ? val : 0, offset, end);
  return this;
};
Buffer.prototype.equals = function(other) {
  if (this.length !== other.length) return false;
  for (var i = 0; i < this.length; i++) {
    if (this._data[i] !== other._data[i]) return false;
  }
  return true;
};
Buffer.prototype.readUInt8 = function(offset) { return this._data[offset]; };
Buffer.prototype.writeUInt8 = function(value, offset) { this._data[offset] = value; return offset + 1; };
globalThis[Symbol.for('jb:buffer')] = { Buffer: Buffer };
globalThis.Buffer = Buffer;
`;

/** Stream module — minimal stubs based on EventEmitter */
export const STREAM_MODULE_SOURCE = `
var _EE = globalThis[Symbol.for('jb:events')].EventEmitter;

function Stream() { _EE.call(this); }
Stream.prototype = Object.create(_EE.prototype);
Stream.prototype.constructor = Stream;
Stream.prototype.pipe = function(dest) {
  this.on('data', function(chunk) { dest.write(chunk); });
  this.on('end', function() { if (dest.end) dest.end(); });
  return dest;
};

function Readable(opts) {
  Stream.call(this);
  this.readable = true;
  this._readableState = { ended: false, buffer: [] };
}
Readable.prototype = Object.create(Stream.prototype);
Readable.prototype.constructor = Readable;
Readable.prototype.read = function() { return null; };
Readable.prototype.push = function(chunk) {
  if (chunk === null) { this._readableState.ended = true; this.emit('end'); return false; }
  this.emit('data', chunk);
  return true;
};
Readable.prototype.destroy = function() { this.emit('close'); return this; };

function Writable(opts) {
  Stream.call(this);
  this.writable = true;
  this._writableState = { ended: false };
}
Writable.prototype = Object.create(Stream.prototype);
Writable.prototype.constructor = Writable;
Writable.prototype.write = function(chunk) { return true; };
Writable.prototype.end = function(chunk) {
  if (chunk) this.write(chunk);
  this._writableState.ended = true;
  this.emit('finish');
  return this;
};
Writable.prototype.destroy = function() { this.emit('close'); return this; };

function Duplex(opts) {
  Readable.call(this, opts);
  Writable.call(this, opts);
}
Duplex.prototype = Object.create(Readable.prototype);
var _wKeys = Object.keys(Writable.prototype);
for (var _wi = 0; _wi < _wKeys.length; _wi++) {
  if (!Duplex.prototype[_wKeys[_wi]]) Duplex.prototype[_wKeys[_wi]] = Writable.prototype[_wKeys[_wi]];
}
Duplex.prototype.constructor = Duplex;

function Transform(opts) { Duplex.call(this, opts); }
Transform.prototype = Object.create(Duplex.prototype);
Transform.prototype.constructor = Transform;
Transform.prototype._transform = function(chunk, encoding, cb) { if (cb) cb(null, chunk); };

function PassThrough(opts) { Transform.call(this, opts); }
PassThrough.prototype = Object.create(Transform.prototype);
PassThrough.prototype.constructor = PassThrough;

function pipeline() {
  var streams = Array.prototype.slice.call(arguments);
  var cb = typeof streams[streams.length - 1] === 'function' ? streams.pop() : null;
  for (var i = 0; i < streams.length - 1; i++) streams[i].pipe(streams[i + 1]);
  if (cb) {
    var last = streams[streams.length - 1];
    last.on('finish', function() { cb(null); });
    last.on('error', function(e) { cb(e); });
  }
  return streams[streams.length - 1];
}

globalThis[Symbol.for('jb:stream')] = {
  Stream: Stream, Readable: Readable, Writable: Writable,
  Duplex: Duplex, Transform: Transform, PassThrough: PassThrough,
  pipeline: pipeline
};
`;

/** StringDecoder module — uses _utf8Decode from Buffer shim */
export const STRING_DECODER_MODULE_SOURCE = `
function StringDecoder(encoding) {
  this.encoding = (encoding || 'utf-8').toLowerCase();
  if (this.encoding === 'utf8') this.encoding = 'utf-8';
}
StringDecoder.prototype.write = function(buf) {
  if (typeof buf === 'string') return buf;
  var data = buf instanceof Uint8Array ? buf : (buf && buf._data ? buf._data : new Uint8Array(0));
  return _utf8Decode(data);
};
StringDecoder.prototype.end = function(buf) {
  if (buf) return this.write(buf);
  return '';
};
globalThis[Symbol.for('jb:string_decoder')] = { StringDecoder: StringDecoder };
`;

/** Querystring module — pure JS */
export const QUERYSTRING_MODULE_SOURCE = `
var _qs = {
  parse: function(str, sep, eq) {
    sep = sep || '&'; eq = eq || '=';
    var result = Object.create(null);
    if (!str || typeof str !== 'string') return result;
    var pairs = str.split(sep);
    for (var i = 0; i < pairs.length; i++) {
      var idx = pairs[i].indexOf(eq);
      var key, val;
      if (idx >= 0) {
        key = decodeURIComponent(pairs[i].slice(0, idx).replace(/\\+/g, ' '));
        val = decodeURIComponent(pairs[i].slice(idx + 1).replace(/\\+/g, ' '));
      } else {
        key = decodeURIComponent(pairs[i].replace(/\\+/g, ' '));
        val = '';
      }
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) result[key].push(val);
        else result[key] = [result[key], val];
      } else {
        result[key] = val;
      }
    }
    return result;
  },
  stringify: function(obj, sep, eq) {
    sep = sep || '&'; eq = eq || '=';
    var pairs = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = obj[key];
      if (Array.isArray(val)) {
        for (var j = 0; j < val.length; j++) {
          pairs.push(encodeURIComponent(key) + eq + encodeURIComponent(val[j]));
        }
      } else {
        pairs.push(encodeURIComponent(key) + eq + encodeURIComponent(val));
      }
    }
    return pairs.join(sep);
  },
  escape: function(str) { return encodeURIComponent(str); },
  unescape: function(str) { return decodeURIComponent(str); }
};
_qs.decode = _qs.parse;
_qs.encode = _qs.stringify;
globalThis[Symbol.for('jb:querystring')] = _qs;
`;

/**
 * Unsupported Node.js modules — throw clear error at require/import time.
 * Map of module name to hint message.
 */
export const UNSUPPORTED_MODULES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    http: "Use fetch() for HTTP requests.",
    https: "Use fetch() for HTTP requests.",
    http2: "Use fetch() for HTTP requests.",
    net: "Network socket APIs are not supported.",
    tls: "Network socket APIs are not supported.",
    dgram: "Network socket APIs are not supported.",
    dns: "DNS APIs are not supported.",
    cluster: "Cluster APIs are not supported.",
    worker_threads: "Worker thread APIs are not supported.",
    vm: "VM APIs are not supported.",
    v8: "V8 APIs are not supported.",
    inspector: "Inspector APIs are not supported.",
    readline: "Readline APIs are not supported.",
    repl: "REPL APIs are not supported.",
    module: "Module APIs are not supported.",
    perf_hooks: "Performance hooks are not supported.",
    async_hooks: "Async hooks are not supported.",
    diagnostics_channel: "Diagnostics channel is not supported.",
    trace_events: "Trace events are not supported.",
    crypto: "Crypto APIs are not available in this sandbox.",
    zlib: "Compression APIs are not supported.",
    tty: "TTY APIs are not supported.",
    domain: "Domain APIs are not supported.",
  },
);
