/**
 * Pure-JS POSIX path module source for QuickJS.
 * Exported as a string constant to be evaluated inside the sandbox.
 * Wrapped in an IIFE to avoid name conflicts with module-level exports.
 */
export const PATH_MODULE_SOURCE = `
(function() {
  var sep = '/';
  var delimiter = ':';

  function normalize(p) {
    if (p === '') return '.';
    var isAbs = p.charCodeAt(0) === 47;
    var trailingSlash = p.charCodeAt(p.length - 1) === 47;
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else if (!isAbs) out.push('..');
      } else {
        out.push(seg);
      }
    }
    var result = out.join('/');
    if (isAbs) result = '/' + result;
    if (trailingSlash && result[result.length - 1] !== '/') result += '/';
    return result || (isAbs ? '/' : '.');
  }

  function join() {
    var joined = '';
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      if (typeof arg !== 'string') throw new TypeError('Path must be a string');
      if (arg.length > 0) {
        if (joined.length > 0) joined += '/' + arg;
        else joined = arg;
      }
    }
    if (joined.length === 0) return '.';
    return normalize(joined);
  }

  function resolve() {
    var resolved = '';
    var resolvedAbsolute = false;
    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path = i >= 0 ? arguments[i] : globalThis.process.cwd();
      if (typeof path !== 'string') throw new TypeError('Path must be a string');
      if (path.length === 0) continue;
      if (resolved.length > 0) resolved = path + '/' + resolved;
      else resolved = path;
      resolvedAbsolute = path.charCodeAt(0) === 47;
    }
    resolved = normalize(resolved);
    if (resolvedAbsolute) return '/' + resolved.replace(/^\\/+/, '');
    return resolved.length > 0 ? resolved : '.';
  }

  function isAbsolute(p) {
    return typeof p === 'string' && p.length > 0 && p.charCodeAt(0) === 47;
  }

  function dirname(p) {
    if (p.length === 0) return '.';
    var hasRoot = p.charCodeAt(0) === 47;
    var end = -1;
    for (var i = p.length - 1; i >= 1; i--) {
      if (p.charCodeAt(i) === 47) { end = i; break; }
    }
    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 0) return '/';
    return p.slice(0, end);
  }

  function basename(p, ext) {
    var start = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      if (p.charCodeAt(i) === 47) { start = i + 1; break; }
    }
    var base = p.slice(start);
    if (ext && base.endsWith(ext)) {
      base = base.slice(0, base.length - ext.length);
    }
    return base;
  }

  function extname(p) {
    var startDot = -1;
    var startPart = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      var code = p.charCodeAt(i);
      if (code === 47) { startPart = i + 1; break; }
      if (code === 46 && startDot === -1) startDot = i;
    }
    if (startDot === -1 || startDot === startPart ||
        (startDot === startPart + 1 && p.charCodeAt(startPart) === 46)) {
      return '';
    }
    return p.slice(startDot);
  }

  function relative(from, to) {
    if (from === to) return '';
    from = resolve(from);
    to = resolve(to);
    if (from === to) return '';
    var fromParts = from.split('/').filter(Boolean);
    var toParts = to.split('/').filter(Boolean);
    var common = 0;
    var length = Math.min(fromParts.length, toParts.length);
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) break;
      common++;
    }
    var ups = [];
    for (var i = common; i < fromParts.length; i++) ups.push('..');
    return ups.concat(toParts.slice(common)).join('/') || '.';
  }

  function parse(p) {
    var root = p.charCodeAt(0) === 47 ? '/' : '';
    var dir = dirname(p);
    var base = basename(p);
    var ext = extname(p);
    var name = ext ? base.slice(0, base.length - ext.length) : base;
    return { root: root, dir: dir, base: base, ext: ext, name: name };
  }

  function format(obj) {
    var dir = obj.dir || obj.root || '';
    var base = obj.base || ((obj.name || '') + (obj.ext || ''));
    if (!dir) return base;
    if (dir === obj.root) return dir + base;
    return dir + '/' + base;
  }

  var posix = { sep: sep, delimiter: delimiter, join: join, resolve: resolve, normalize: normalize, isAbsolute: isAbsolute, dirname: dirname, basename: basename, extname: extname, relative: relative, parse: parse, format: format };
  posix.posix = posix;

  globalThis.__path = posix;
})();
`;
