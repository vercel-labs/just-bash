const schemeRegex = /^[\w+.-]+:\/\//;
const urlRegex = /^([\w+.-]+:)\/\/([^@/#?]*@)?([^:/#?]*)(:\d+)?(\/[^#?]*)?(\?[^#]*)?(#.*)?/;
const fileRegex = /^file:(?:\/\/((?![a-z]:)[^/#?]*)?)?(\/?[^#?]*)(\?[^#]*)?(#.*)?/i;
function isAbsoluteUrl(input) {
  return schemeRegex.test(input);
}
function isSchemeRelativeUrl(input) {
  return input.startsWith("//");
}
function isAbsolutePath(input) {
  return input.startsWith("/");
}
function isFileUrl(input) {
  return input.startsWith("file:");
}
function isRelative(input) {
  return /^[.?#]/.test(input);
}
function parseAbsoluteUrl(input) {
  const match = urlRegex.exec(input);
  return makeUrl(match[1], match[2] || "", match[3], match[4] || "", match[5] || "/", match[6] || "", match[7] || "");
}
function parseFileUrl(input) {
  const match = fileRegex.exec(input);
  const path = match[2];
  return makeUrl("file:", "", match[1] || "", "", isAbsolutePath(path) ? path : "/" + path, match[3] || "", match[4] || "");
}
function makeUrl(scheme, user, host, port, path, query, hash) {
  return {
    scheme,
    user,
    host,
    port,
    path,
    query,
    hash,
    type: 7
  };
}
function parseUrl(input) {
  if (isSchemeRelativeUrl(input)) {
    const url2 = parseAbsoluteUrl("http:" + input);
    url2.scheme = "";
    url2.type = 6;
    return url2;
  }
  if (isAbsolutePath(input)) {
    const url2 = parseAbsoluteUrl("http://foo.com" + input);
    url2.scheme = "";
    url2.host = "";
    url2.type = 5;
    return url2;
  }
  if (isFileUrl(input))
    return parseFileUrl(input);
  if (isAbsoluteUrl(input))
    return parseAbsoluteUrl(input);
  const url = parseAbsoluteUrl("http://foo.com/" + input);
  url.scheme = "";
  url.host = "";
  url.type = input ? input.startsWith("?") ? 3 : input.startsWith("#") ? 2 : 4 : 1;
  return url;
}
function stripPathFilename(path) {
  if (path.endsWith("/.."))
    return path;
  const index = path.lastIndexOf("/");
  return path.slice(0, index + 1);
}
function mergePaths(url, base) {
  normalizePath(base, base.type);
  if (url.path === "/") {
    url.path = base.path;
  } else {
    url.path = stripPathFilename(base.path) + url.path;
  }
}
function normalizePath(url, type) {
  const rel = type <= 4;
  const pieces = url.path.split("/");
  let pointer = 1;
  let positive = 0;
  let addTrailingSlash = false;
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece) {
      addTrailingSlash = true;
      continue;
    }
    addTrailingSlash = false;
    if (piece === ".")
      continue;
    if (piece === "..") {
      if (positive) {
        addTrailingSlash = true;
        positive--;
        pointer--;
      } else if (rel) {
        pieces[pointer++] = piece;
      }
      continue;
    }
    pieces[pointer++] = piece;
    positive++;
  }
  let path = "";
  for (let i = 1; i < pointer; i++) {
    path += "/" + pieces[i];
  }
  if (!path || addTrailingSlash && !path.endsWith("/..")) {
    path += "/";
  }
  url.path = path;
}
function resolve(input, base) {
  if (!input && !base)
    return "";
  const url = parseUrl(input);
  let inputType = url.type;
  if (base && inputType !== 7) {
    const baseUrl = parseUrl(base);
    const baseType = baseUrl.type;
    switch (inputType) {
      case 1:
        url.hash = baseUrl.hash;
      // fall through
      case 2:
        url.query = baseUrl.query;
      // fall through
      case 3:
      case 4:
        mergePaths(url, baseUrl);
      // fall through
      case 5:
        url.user = baseUrl.user;
        url.host = baseUrl.host;
        url.port = baseUrl.port;
      // fall through
      case 6:
        url.scheme = baseUrl.scheme;
    }
    if (baseType > inputType)
      inputType = baseType;
  }
  normalizePath(url, inputType);
  const queryHash = url.query + url.hash;
  switch (inputType) {
    // This is impossible, because of the empty checks at the start of the function.
    // case UrlType.Empty:
    case 2:
    case 3:
      return queryHash;
    case 4: {
      const path = url.path.slice(1);
      if (!path)
        return queryHash || ".";
      if (isRelative(base || input) && !isRelative(path)) {
        return "./" + path + queryHash;
      }
      return path + queryHash;
    }
    case 5:
      return url.path + queryHash;
    default:
      return url.scheme + "//" + url.user + url.host + url.port + url.path + queryHash;
  }
}
export {
  resolve as r
};
