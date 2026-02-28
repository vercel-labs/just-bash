/**
 * Web Fetch API polyfill source for QuickJS.
 * Exported as a string constant to be evaluated inside the sandbox.
 * Provides URLSearchParams, URL, Headers, Response, Request, and fetch().
 */
export const FETCH_POLYFILL_SOURCE = `
(function() {
  // --- URLSearchParams ---
  function URLSearchParams(init) {
    this._entries = [];
    if (!init) return;
    if (typeof init === 'string') {
      var s = init;
      if (s.charAt(0) === '?') s = s.slice(1);
      var pairs = s.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        if (pair === '') continue;
        var eq = pair.indexOf('=');
        if (eq === -1) {
          this._entries.push([decodeURIComponent(pair), '']);
        } else {
          this._entries.push([
            decodeURIComponent(pair.slice(0, eq)),
            decodeURIComponent(pair.slice(eq + 1))
          ]);
        }
      }
    } else if (typeof init === 'object' && init !== null) {
      if (init instanceof URLSearchParams) {
        this._entries = init._entries.slice();
      } else {
        var keys = Object.keys(init);
        for (var i = 0; i < keys.length; i++) {
          this._entries.push([keys[i], String(init[keys[i]])]);
        }
      }
    }
  }

  URLSearchParams.prototype.append = function(name, value) {
    this._entries.push([String(name), String(value)]);
  };

  URLSearchParams.prototype.delete = function(name) {
    var n = String(name);
    this._entries = this._entries.filter(function(e) { return e[0] !== n; });
  };

  URLSearchParams.prototype.get = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return this._entries[i][1];
    }
    return null;
  };

  URLSearchParams.prototype.getAll = function(name) {
    var n = String(name);
    var result = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) result.push(this._entries[i][1]);
    }
    return result;
  };

  URLSearchParams.prototype.has = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return true;
    }
    return false;
  };

  URLSearchParams.prototype.set = function(name, value) {
    var n = String(name);
    var v = String(value);
    var found = false;
    var newEntries = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) {
        if (!found) {
          newEntries.push([n, v]);
          found = true;
        }
      } else {
        newEntries.push(this._entries[i]);
      }
    }
    if (!found) newEntries.push([n, v]);
    this._entries = newEntries;
  };

  URLSearchParams.prototype.sort = function() {
    this._entries.sort(function(a, b) {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
  };

  URLSearchParams.prototype.toString = function() {
    return this._entries.map(function(e) {
      return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]);
    }).join('&');
  };

  URLSearchParams.prototype.forEach = function(callback, thisArg) {
    for (var i = 0; i < this._entries.length; i++) {
      callback.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };

  URLSearchParams.prototype.entries = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++].slice() };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.keys = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][0] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.values = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][1] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;

  Object.defineProperty(URLSearchParams.prototype, 'size', {
    get: function() { return this._entries.length; }
  });

  // --- URL ---
  var urlRegex = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\\/\\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?([^:/?#]*)(?::([0-9]+))?)?(\\/[^?#]*)?(?:\\?([^#]*))?(?:#(.*))?$/;

  function URL(url, base) {
    var input = String(url);

    if (base !== undefined) {
      var baseUrl = (base instanceof URL) ? base : new URL(String(base));
      // Resolve relative URL against base
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
        // Absolute URL - parse as-is
      } else if (input.charAt(0) === '/' && input.charAt(1) === '/') {
        // Protocol-relative
        input = baseUrl.protocol + input;
      } else if (input.charAt(0) === '/') {
        // Absolute path
        input = baseUrl.origin + input;
      } else if (input.charAt(0) === '?' || input.charAt(0) === '#') {
        // Query or hash only
        var basePath = baseUrl.protocol + '//' + baseUrl.host + baseUrl.pathname;
        if (input.charAt(0) === '#') {
          input = basePath + baseUrl.search + input;
        } else {
          input = basePath + input;
        }
      } else {
        // Relative path
        var basePath = baseUrl.protocol + '//' + baseUrl.host;
        var dirPath = baseUrl.pathname;
        var lastSlash = dirPath.lastIndexOf('/');
        if (lastSlash >= 0) dirPath = dirPath.slice(0, lastSlash + 1);
        else dirPath = '/';
        input = basePath + dirPath + input;
      }
    }

    var m = urlRegex.exec(input);
    if (!m) throw new TypeError("Invalid URL: " + String(url));

    this.protocol = m[1].toLowerCase() + ':';
    this.username = m[2] ? decodeURIComponent(m[2]) : '';
    this.password = m[3] ? decodeURIComponent(m[3]) : '';
    this.hostname = m[4] || '';
    this.port = m[5] || '';
    this.pathname = m[6] || '/';
    this.hash = m[8] ? '#' + m[8] : '';

    // Normalize pathname (resolve . and ..)
    var parts = this.pathname.split('/');
    var resolved = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') { if (resolved.length > 1) resolved.pop(); }
      else if (parts[i] !== '.') resolved.push(parts[i]);
    }
    this.pathname = resolved.join('/') || '/';

    // searchParams is live
    this._searchParamsStr = m[7] || '';
    this.searchParams = new URLSearchParams(this._searchParamsStr);
  }

  Object.defineProperty(URL.prototype, 'search', {
    get: function() {
      var s = this.searchParams.toString();
      return s ? '?' + s : '';
    },
    set: function(v) {
      this.searchParams = new URLSearchParams(String(v));
    }
  });

  Object.defineProperty(URL.prototype, 'host', {
    get: function() {
      return this.port ? this.hostname + ':' + this.port : this.hostname;
    }
  });

  Object.defineProperty(URL.prototype, 'origin', {
    get: function() {
      return this.protocol + '//' + this.host;
    }
  });

  Object.defineProperty(URL.prototype, 'href', {
    get: function() {
      var auth = '';
      if (this.username) {
        auth = this.username;
        if (this.password) auth += ':' + this.password;
        auth += '@';
      }
      return this.protocol + '//' + auth + this.host + this.pathname + this.search + this.hash;
    },
    set: function(v) {
      var parsed = new URL(String(v));
      this.protocol = parsed.protocol;
      this.username = parsed.username;
      this.password = parsed.password;
      this.hostname = parsed.hostname;
      this.port = parsed.port;
      this.pathname = parsed.pathname;
      this.searchParams = parsed.searchParams;
      this.hash = parsed.hash;
    }
  });

  URL.prototype.toString = function() { return this.href; };
  URL.prototype.toJSON = function() { return this.href; };

  // --- Headers ---
  function Headers(init) {
    this._map = {};
    if (!init) return;
    if (init instanceof Headers) {
      var keys = Object.keys(init._map);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i]] = init._map[keys[i]].slice();
      }
    } else if (typeof init === 'object') {
      var keys = Object.keys(init);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i].toLowerCase()] = [String(init[keys[i]])];
      }
    }
  }

  Headers.prototype.append = function(name, value) {
    var key = String(name).toLowerCase();
    if (!this._map[key]) this._map[key] = [];
    this._map[key].push(String(value));
  };

  Headers.prototype.delete = function(name) {
    delete this._map[String(name).toLowerCase()];
  };

  Headers.prototype.get = function(name) {
    var vals = this._map[String(name).toLowerCase()];
    return vals ? vals.join(', ') : null;
  };

  Headers.prototype.has = function(name) {
    return String(name).toLowerCase() in this._map;
  };

  Headers.prototype.set = function(name, value) {
    this._map[String(name).toLowerCase()] = [String(value)];
  };

  Headers.prototype.forEach = function(callback, thisArg) {
    var keys = Object.keys(this._map).sort();
    for (var i = 0; i < keys.length; i++) {
      callback.call(thisArg, this._map[keys[i]].join(', '), keys[i], this);
    }
  };

  Headers.prototype.entries = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        var k = keys[idx++];
        return { done: false, value: [k, map[k].join(', ')] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.keys = function() {
    var keys = Object.keys(this._map).sort();
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: keys[idx++] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.values = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: map[keys[idx++]].join(', ') };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype[Symbol.iterator] = Headers.prototype.entries;

  // --- Response ---
  function Response(body, init) {
    if (init === undefined) init = {};
    this.status = init.status !== undefined ? init.status : 200;
    this.statusText = init.statusText !== undefined ? init.statusText : '';
    this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    this.body = body !== undefined && body !== null ? String(body) : '';
    this.ok = this.status >= 200 && this.status <= 299;
    this.url = '';
    this.redirected = false;
    this.type = 'basic';
    this.bodyUsed = false;
  }

  Response.prototype.text = function() {
    this.bodyUsed = true;
    return Promise.resolve(this.body);
  };

  Response.prototype.json = function() {
    this.bodyUsed = true;
    try {
      return Promise.resolve(JSON.parse(this.body));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  Response.prototype.clone = function() {
    var r = new Response(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers)
    });
    r.url = this.url;
    r.redirected = this.redirected;
    r.type = this.type;
    return r;
  };

  Response.json = function(data, init) {
    if (init === undefined) init = {};
    var headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new Response(JSON.stringify(data), {
      status: init.status !== undefined ? init.status : 200,
      statusText: init.statusText || '',
      headers: headers
    });
  };

  Response.error = function() {
    var r = new Response(null, { status: 0, statusText: '' });
    r.type = 'error';
    r.ok = false;
    return r;
  };

  Response.redirect = function(url, status) {
    if (status === undefined) status = 302;
    var r = new Response(null, {
      status: status,
      statusText: '',
      headers: new Headers({ location: String(url) })
    });
    r.redirected = true;
    return r;
  };

  // --- Request ---
  function Request(input, init) {
    if (init === undefined) init = {};
    if (input instanceof Request) {
      this.url = input.url;
      this.method = input.method;
      this.headers = new Headers(input.headers);
      this.body = input.body;
    } else {
      this.url = String(input);
      this.method = 'GET';
      this.headers = new Headers();
      this.body = null;
    }
    if (init.method !== undefined) this.method = String(init.method).toUpperCase();
    if (init.headers !== undefined) this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (init.body !== undefined) this.body = init.body !== null ? String(init.body) : null;
  }

  Request.prototype.clone = function() {
    return new Request(this);
  };

  // --- Assign to globalThis ---
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.URL = URL;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.Request = Request;

  // --- Wrap native fetch ---
  var _nativeFetch = globalThis.__fetch;
  globalThis.fetch = function fetch(input, init) {
    try {
      var url, method, headers, body;

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
        headers = {};
        input.headers.forEach(function(v, k) { headers[k] = v; });
        body = input.body;
      } else {
        url = String(input);
        method = undefined;
        headers = undefined;
        body = undefined;
      }

      if (init) {
        if (init.method !== undefined) method = String(init.method).toUpperCase();
        if (init.headers !== undefined) {
          var h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
          headers = {};
          h.forEach(function(v, k) { headers[k] = v; });
        }
        if (init.body !== undefined) body = init.body !== null ? String(init.body) : undefined;
      }

      var opts = {};
      if (method) opts.method = method;
      if (headers) opts.headers = headers;
      if (body) opts.body = body;

      var raw = _nativeFetch(url, opts);

      var respHeaders = new Headers(raw.headers || {});
      var response = new Response(raw.body, {
        status: raw.status,
        statusText: raw.statusText || '',
        headers: respHeaders
      });
      response.url = raw.url || url;

      return Promise.resolve(response);
    } catch (e) {
      return Promise.reject(new TypeError(e.message || 'fetch failed'));
    }
  };
})();
`;
