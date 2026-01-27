var headers;
var hasRequiredHeaders;
function requireHeaders() {
  if (hasRequiredHeaders) return headers;
  hasRequiredHeaders = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var headers_exports = {};
  __export(headers_exports, {
    CITY_HEADER_NAME: () => CITY_HEADER_NAME,
    COUNTRY_HEADER_NAME: () => COUNTRY_HEADER_NAME,
    EMOJI_FLAG_UNICODE_STARTING_POSITION: () => EMOJI_FLAG_UNICODE_STARTING_POSITION,
    IP_HEADER_NAME: () => IP_HEADER_NAME,
    LATITUDE_HEADER_NAME: () => LATITUDE_HEADER_NAME,
    LONGITUDE_HEADER_NAME: () => LONGITUDE_HEADER_NAME,
    POSTAL_CODE_HEADER_NAME: () => POSTAL_CODE_HEADER_NAME,
    REGION_HEADER_NAME: () => REGION_HEADER_NAME,
    REQUEST_ID_HEADER_NAME: () => REQUEST_ID_HEADER_NAME,
    geolocation: () => geolocation,
    ipAddress: () => ipAddress
  });
  headers = __toCommonJS(headers_exports);
  const CITY_HEADER_NAME = "x-vercel-ip-city";
  const COUNTRY_HEADER_NAME = "x-vercel-ip-country";
  const IP_HEADER_NAME = "x-real-ip";
  const LATITUDE_HEADER_NAME = "x-vercel-ip-latitude";
  const LONGITUDE_HEADER_NAME = "x-vercel-ip-longitude";
  const REGION_HEADER_NAME = "x-vercel-ip-country-region";
  const POSTAL_CODE_HEADER_NAME = "x-vercel-ip-postal-code";
  const REQUEST_ID_HEADER_NAME = "x-vercel-id";
  const EMOJI_FLAG_UNICODE_STARTING_POSITION = 127397;
  function getHeader(headers2, key) {
    return headers2.get(key) ?? void 0;
  }
  function getHeaderWithDecode(request, key) {
    const header = getHeader(request.headers, key);
    return header ? decodeURIComponent(header) : void 0;
  }
  function getFlag(countryCode) {
    const regex = new RegExp("^[A-Z]{2}$").test(countryCode);
    if (!countryCode || !regex)
      return void 0;
    return String.fromCodePoint(
      ...countryCode.split("").map((char) => EMOJI_FLAG_UNICODE_STARTING_POSITION + char.charCodeAt(0))
    );
  }
  function ipAddress(input) {
    const headers2 = "headers" in input ? input.headers : input;
    return getHeader(headers2, IP_HEADER_NAME);
  }
  function getRegionFromRequestId(requestId) {
    if (!requestId) {
      return "dev1";
    }
    return requestId.split(":")[0];
  }
  function geolocation(request) {
    return {
      // city name may be encoded to support multi-byte characters
      city: getHeaderWithDecode(request, CITY_HEADER_NAME),
      country: getHeader(request.headers, COUNTRY_HEADER_NAME),
      flag: getFlag(getHeader(request.headers, COUNTRY_HEADER_NAME)),
      countryRegion: getHeader(request.headers, REGION_HEADER_NAME),
      region: getRegionFromRequestId(
        getHeader(request.headers, REQUEST_ID_HEADER_NAME)
      ),
      latitude: getHeader(request.headers, LATITUDE_HEADER_NAME),
      longitude: getHeader(request.headers, LONGITUDE_HEADER_NAME),
      postalCode: getHeader(request.headers, POSTAL_CODE_HEADER_NAME)
    };
  }
  return headers;
}
var getEnv_1;
var hasRequiredGetEnv;
function requireGetEnv() {
  if (hasRequiredGetEnv) return getEnv_1;
  hasRequiredGetEnv = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var get_env_exports = {};
  __export(get_env_exports, {
    getEnv: () => getEnv
  });
  getEnv_1 = __toCommonJS(get_env_exports);
  const getEnv = (env = process.env) => ({
    /**
     * An indicator to show that System Environment Variables have been exposed to your project's Deployments.
     * @example "1"
     */
    VERCEL: get(env, "VERCEL"),
    /**
     * An indicator that the code is running in a Continuous Integration environment.
     * @example "1"
     */
    CI: get(env, "CI"),
    /**
     * The Environment that the app is deployed and running on.
     * @example "production"
     */
    VERCEL_ENV: get(env, "VERCEL_ENV"),
    /**
     * The domain name of the generated deployment URL. The value does not include the protocol scheme https://.
     * NOTE: This Variable cannot be used in conjunction with Standard Deployment Protection.
     * @example "*.vercel.app"
     */
    VERCEL_URL: get(env, "VERCEL_URL"),
    /**
     * The domain name of the generated Git branch URL. The value does not include the protocol scheme https://.
     * @example "*-git-*.vercel.app"
     */
    VERCEL_BRANCH_URL: get(env, "VERCEL_BRANCH_URL"),
    /**
     * A production domain name of the project. This is useful to reliably generate links that point to production such as OG-image URLs.
     * The value does not include the protocol scheme https://.
     * @example "myproject.vercel.app"
     */
    VERCEL_PROJECT_PRODUCTION_URL: get(env, "VERCEL_PROJECT_PRODUCTION_URL"),
    /**
     * The ID of the Region where the app is running.
     *
     * Possible values:
     * - arn1 (Stockholm, Sweden)
     * - bom1 (Mumbai, India)
     * - cdg1 (Paris, France)
     * - cle1 (Cleveland, USA)
     * - cpt1 (Cape Town, South Africa)
     * - dub1 (Dublin, Ireland)
     * - fra1 (Frankfurt, Germany)
     * - gru1 (São Paulo, Brazil)
     * - hkg1 (Hong Kong)
     * - hnd1 (Tokyo, Japan)
     * - iad1 (Washington, D.C., USA)
     * - icn1 (Seoul, South Korea)
     * - kix1 (Osaka, Japan)
     * - lhr1 (London, United Kingdom)
     * - pdx1 (Portland, USA)
     * - sfo1 (San Francisco, USA)
     * - sin1 (Singapore)
     * - syd1 (Sydney, Australia)
     * - dev1 (Development Region)
     *
     * @example "iad1"
     */
    VERCEL_REGION: get(env, "VERCEL_REGION"),
    /**
     * The unique identifier for the deployment, which can be used to implement Skew Protection.
     * @example "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3"
     */
    VERCEL_DEPLOYMENT_ID: get(env, "VERCEL_DEPLOYMENT_ID"),
    /**
     * When Skew Protection is enabled in Project Settings, this value is set to 1.
     * @example "1"
     */
    VERCEL_SKEW_PROTECTION_ENABLED: get(env, "VERCEL_SKEW_PROTECTION_ENABLED"),
    /**
     * The Protection Bypass for Automation value, if the secret has been generated in the project's Deployment Protection settings.
     */
    VERCEL_AUTOMATION_BYPASS_SECRET: get(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
    /**
     * The Git Provider the deployment is triggered from.
     * @example "github"
     */
    VERCEL_GIT_PROVIDER: get(env, "VERCEL_GIT_PROVIDER"),
    /**
     * The origin repository the deployment is triggered from.
     * @example "my-site"
     */
    VERCEL_GIT_REPO_SLUG: get(env, "VERCEL_GIT_REPO_SLUG"),
    /**
     * The account that owns the repository the deployment is triggered from.
     * @example "acme"
     */
    VERCEL_GIT_REPO_OWNER: get(env, "VERCEL_GIT_REPO_OWNER"),
    /**
     * The ID of the repository the deployment is triggered from.
     * @example "117716146"
     */
    VERCEL_GIT_REPO_ID: get(env, "VERCEL_GIT_REPO_ID"),
    /**
     * The git branch of the commit the deployment was triggered by.
     * @example "improve-about-page"
     */
    VERCEL_GIT_COMMIT_REF: get(env, "VERCEL_GIT_COMMIT_REF"),
    /**
     * The git SHA of the commit the deployment was triggered by.
     * @example "fa1eade47b73733d6312d5abfad33ce9e4068081"
     */
    VERCEL_GIT_COMMIT_SHA: get(env, "VERCEL_GIT_COMMIT_SHA"),
    /**
     * The message attached to the commit the deployment was triggered by.
     * @example "Update about page"
     */
    VERCEL_GIT_COMMIT_MESSAGE: get(env, "VERCEL_GIT_COMMIT_MESSAGE"),
    /**
     * The username attached to the author of the commit that the project was deployed by.
     * @example "johndoe"
     */
    VERCEL_GIT_COMMIT_AUTHOR_LOGIN: get(env, "VERCEL_GIT_COMMIT_AUTHOR_LOGIN"),
    /**
     * The name attached to the author of the commit that the project was deployed by.
     * @example "John Doe"
     */
    VERCEL_GIT_COMMIT_AUTHOR_NAME: get(env, "VERCEL_GIT_COMMIT_AUTHOR_NAME"),
    /**
     * The git SHA of the last successful deployment for the project and branch.
     * NOTE: This Variable is only exposed when an Ignored Build Step is provided.
     * @example "fa1eade47b73733d6312d5abfad33ce9e4068080"
     */
    VERCEL_GIT_PREVIOUS_SHA: get(env, "VERCEL_GIT_PREVIOUS_SHA"),
    /**
     * The pull request id the deployment was triggered by. If a deployment is created on a branch before a pull request is made, this value will be an empty string.
     * @example "23"
     */
    VERCEL_GIT_PULL_REQUEST_ID: get(env, "VERCEL_GIT_PULL_REQUEST_ID")
  });
  const get = (env, key) => {
    const value = env[key];
    return value === "" ? void 0 : value;
  };
  return getEnv_1;
}
var getContext_1;
var hasRequiredGetContext;
function requireGetContext() {
  if (hasRequiredGetContext) return getContext_1;
  hasRequiredGetContext = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var get_context_exports = {};
  __export(get_context_exports, {
    SYMBOL_FOR_REQ_CONTEXT: () => SYMBOL_FOR_REQ_CONTEXT,
    getContext: () => getContext
  });
  getContext_1 = __toCommonJS(get_context_exports);
  const SYMBOL_FOR_REQ_CONTEXT = /* @__PURE__ */ Symbol.for("@vercel/request-context");
  function getContext() {
    const fromSymbol = globalThis;
    return fromSymbol[SYMBOL_FOR_REQ_CONTEXT]?.get?.() ?? {};
  }
  return getContext_1;
}
var waitUntil_1;
var hasRequiredWaitUntil;
function requireWaitUntil() {
  if (hasRequiredWaitUntil) return waitUntil_1;
  hasRequiredWaitUntil = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var wait_until_exports = {};
  __export(wait_until_exports, {
    waitUntil: () => waitUntil
  });
  waitUntil_1 = __toCommonJS(wait_until_exports);
  var import_get_context = /* @__PURE__ */ requireGetContext();
  const waitUntil = (promise) => {
    if (promise === null || typeof promise !== "object" || typeof promise.then !== "function") {
      throw new TypeError(
        `waitUntil can only be called with a Promise, got ${typeof promise}`
      );
    }
    return (0, import_get_context.getContext)().waitUntil?.(promise);
  };
  return waitUntil_1;
}
var middleware;
var hasRequiredMiddleware;
function requireMiddleware() {
  if (hasRequiredMiddleware) return middleware;
  hasRequiredMiddleware = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var middleware_exports = {};
  __export(middleware_exports, {
    next: () => next,
    rewrite: () => rewrite
  });
  middleware = __toCommonJS(middleware_exports);
  function handleMiddlewareField(init, headers2) {
    if (init?.request?.headers) {
      if (!(init.request.headers instanceof Headers)) {
        throw new Error("request.headers must be an instance of Headers");
      }
      const keys = [];
      for (const [key, value] of init.request.headers) {
        headers2.set("x-middleware-request-" + key, value);
        keys.push(key);
      }
      headers2.set("x-middleware-override-headers", keys.join(","));
    }
  }
  function rewrite(destination, init) {
    const headers2 = new Headers(init?.headers ?? {});
    headers2.set("x-middleware-rewrite", String(destination));
    handleMiddlewareField(init, headers2);
    return new Response(null, {
      ...init,
      headers: headers2
    });
  }
  function next(init) {
    const headers2 = new Headers(init?.headers ?? {});
    headers2.set("x-middleware-next", "1");
    handleMiddlewareField(init, headers2);
    return new Response(null, {
      ...init,
      headers: headers2
    });
  }
  return middleware;
}
var inMemoryCache;
var hasRequiredInMemoryCache;
function requireInMemoryCache() {
  if (hasRequiredInMemoryCache) return inMemoryCache;
  hasRequiredInMemoryCache = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var in_memory_cache_exports = {};
  __export(in_memory_cache_exports, {
    InMemoryCache: () => InMemoryCache
  });
  inMemoryCache = __toCommonJS(in_memory_cache_exports);
  class InMemoryCache {
    constructor() {
      this.cache = {};
    }
    async get(key) {
      const entry = this.cache[key];
      if (entry) {
        if (entry.ttl && entry.lastModified + entry.ttl * 1e3 < Date.now()) {
          await this.delete(key);
          return null;
        }
        return entry.value;
      }
      return null;
    }
    async set(key, value, options) {
      this.cache[key] = {
        value,
        lastModified: Date.now(),
        ttl: options?.ttl,
        tags: new Set(options?.tags || [])
      };
    }
    async delete(key) {
      delete this.cache[key];
    }
    async expireTag(tag) {
      const tags = Array.isArray(tag) ? tag : [tag];
      for (const key in this.cache) {
        if (Object.prototype.hasOwnProperty.call(this.cache, key)) {
          const entry = this.cache[key];
          if (tags.some((t) => entry.tags.has(t))) {
            delete this.cache[key];
          }
        }
      }
    }
  }
  return inMemoryCache;
}
var buildClient;
var hasRequiredBuildClient;
function requireBuildClient() {
  if (hasRequiredBuildClient) return buildClient;
  hasRequiredBuildClient = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var build_client_exports = {};
  __export(build_client_exports, {
    BuildCache: () => BuildCache
  });
  buildClient = __toCommonJS(build_client_exports);
  var import_index = /* @__PURE__ */ requireCache();
  class BuildCache {
    constructor({
      endpoint,
      headers: headers2,
      onError,
      timeout = 500
    }) {
      this.get = async (key) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
          const res = await fetch(`${this.endpoint}${key}`, {
            headers: this.headers,
            method: "GET",
            signal: controller.signal
          });
          if (res.status === 404) {
            clearTimeout(timeoutId);
            return null;
          }
          if (res.status === 200) {
            const cacheState = res.headers.get(
              import_index.HEADERS_VERCEL_CACHE_STATE
            );
            if (cacheState !== import_index.PkgCacheState.Fresh) {
              res.body?.cancel?.();
              clearTimeout(timeoutId);
              return null;
            }
            const result = await res.json();
            clearTimeout(timeoutId);
            return result;
          } else {
            clearTimeout(timeoutId);
            throw new Error(`Failed to get cache: ${res.statusText}`);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === "AbortError") {
            const timeoutError = new Error(
              `Cache request timed out after ${this.timeout}ms`
            );
            timeoutError.stack = error.stack;
            this.onError?.(timeoutError);
          } else {
            this.onError?.(error);
          }
          return null;
        }
      };
      this.set = async (key, value, options) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
          const optionalHeaders = {};
          if (options?.ttl) {
            optionalHeaders[import_index.HEADERS_VERCEL_REVALIDATE] = options.ttl.toString();
          }
          if (options?.tags && options.tags.length > 0) {
            optionalHeaders[import_index.HEADERS_VERCEL_CACHE_TAGS] = options.tags.join(",");
          }
          if (options?.name) {
            optionalHeaders[import_index.HEADERS_VERCEL_CACHE_ITEM_NAME] = options.name;
          }
          const res = await fetch(`${this.endpoint}${key}`, {
            method: "POST",
            headers: {
              ...this.headers,
              ...optionalHeaders
            },
            body: JSON.stringify(value),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.status !== 200) {
            throw new Error(`Failed to set cache: ${res.status} ${res.statusText}`);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === "AbortError") {
            const timeoutError = new Error(
              `Cache request timed out after ${this.timeout}ms`
            );
            timeoutError.stack = error.stack;
            this.onError?.(timeoutError);
          } else {
            this.onError?.(error);
          }
        }
      };
      this.delete = async (key) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
          const res = await fetch(`${this.endpoint}${key}`, {
            method: "DELETE",
            headers: this.headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.status !== 200) {
            throw new Error(`Failed to delete cache: ${res.statusText}`);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === "AbortError") {
            const timeoutError = new Error(
              `Cache request timed out after ${this.timeout}ms`
            );
            timeoutError.stack = error.stack;
            this.onError?.(timeoutError);
          } else {
            this.onError?.(error);
          }
        }
      };
      this.expireTag = async (tag) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
          if (Array.isArray(tag)) {
            tag = tag.join(",");
          }
          const res = await fetch(`${this.endpoint}revalidate?tags=${tag}`, {
            method: "POST",
            headers: this.headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.status !== 200) {
            throw new Error(`Failed to revalidate tag: ${res.statusText}`);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === "AbortError") {
            const timeoutError = new Error(
              `Cache request timed out after ${this.timeout}ms`
            );
            timeoutError.stack = error.stack;
            this.onError?.(timeoutError);
          } else {
            this.onError?.(error);
          }
        }
      };
      this.endpoint = endpoint;
      this.headers = headers2;
      this.onError = onError;
      this.timeout = timeout;
    }
  }
  return buildClient;
}
var cache;
var hasRequiredCache;
function requireCache() {
  if (hasRequiredCache) return cache;
  hasRequiredCache = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var cache_exports = {};
  __export(cache_exports, {
    HEADERS_VERCEL_CACHE_ITEM_NAME: () => HEADERS_VERCEL_CACHE_ITEM_NAME,
    HEADERS_VERCEL_CACHE_STATE: () => HEADERS_VERCEL_CACHE_STATE,
    HEADERS_VERCEL_CACHE_TAGS: () => HEADERS_VERCEL_CACHE_TAGS,
    HEADERS_VERCEL_REVALIDATE: () => HEADERS_VERCEL_REVALIDATE,
    PkgCacheState: () => PkgCacheState,
    getCache: () => getCache
  });
  cache = __toCommonJS(cache_exports);
  var import_get_context = /* @__PURE__ */ requireGetContext();
  var import_in_memory_cache = /* @__PURE__ */ requireInMemoryCache();
  var import_build_client = /* @__PURE__ */ requireBuildClient();
  const defaultKeyHashFunction = (key) => {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = hash * 33 ^ key.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  };
  const defaultNamespaceSeparator = "$";
  let inMemoryCacheInstance = null;
  let buildCacheInstance = null;
  const getCache = (cacheOptions) => {
    const resolveCache = () => {
      let cache2;
      if ((0, import_get_context.getContext)().cache) {
        cache2 = (0, import_get_context.getContext)().cache;
      } else {
        cache2 = getCacheImplementation(
          process.env.SUSPENSE_CACHE_DEBUG === "true"
        );
      }
      return cache2;
    };
    return wrapWithKeyTransformation(
      resolveCache,
      createKeyTransformer(cacheOptions)
    );
  };
  function createKeyTransformer(cacheOptions) {
    const hashFunction = cacheOptions?.keyHashFunction || defaultKeyHashFunction;
    return (key) => {
      if (!cacheOptions?.namespace)
        return hashFunction(key);
      const separator = cacheOptions.namespaceSeparator || defaultNamespaceSeparator;
      return `${cacheOptions.namespace}${separator}${hashFunction(key)}`;
    };
  }
  function wrapWithKeyTransformation(resolveCache, makeKey) {
    return {
      get: (key) => {
        return resolveCache().get(makeKey(key));
      },
      set: (key, value, options) => {
        return resolveCache().set(makeKey(key), value, options);
      },
      delete: (key) => {
        return resolveCache().delete(makeKey(key));
      },
      expireTag: (tag) => {
        return resolveCache().expireTag(tag);
      }
    };
  }
  let warnedCacheUnavailable = false;
  function getCacheImplementation(debug) {
    if (!inMemoryCacheInstance) {
      inMemoryCacheInstance = new import_in_memory_cache.InMemoryCache();
    }
    if (process.env.RUNTIME_CACHE_DISABLE_BUILD_CACHE === "true") {
      debug && console.log("Using InMemoryCache as build cache is disabled");
      return inMemoryCacheInstance;
    }
    const { RUNTIME_CACHE_ENDPOINT, RUNTIME_CACHE_HEADERS } = process.env;
    if (debug) {
      console.log("Runtime cache environment variables:", {
        RUNTIME_CACHE_ENDPOINT,
        RUNTIME_CACHE_HEADERS
      });
    }
    if (!RUNTIME_CACHE_ENDPOINT || !RUNTIME_CACHE_HEADERS) {
      if (!warnedCacheUnavailable) {
        console.warn(
          "Runtime Cache unavailable in this environment. Falling back to in-memory cache."
        );
        warnedCacheUnavailable = true;
      }
      return inMemoryCacheInstance;
    }
    if (!buildCacheInstance) {
      let parsedHeaders = {};
      try {
        parsedHeaders = JSON.parse(RUNTIME_CACHE_HEADERS);
      } catch (e) {
        console.error("Failed to parse RUNTIME_CACHE_HEADERS:", e);
        return inMemoryCacheInstance;
      }
      let timeout = 500;
      if (process.env.RUNTIME_CACHE_TIMEOUT) {
        const parsed = parseInt(process.env.RUNTIME_CACHE_TIMEOUT, 10);
        if (!isNaN(parsed) && parsed > 0) {
          timeout = parsed;
        } else {
          console.warn(
            `Invalid RUNTIME_CACHE_TIMEOUT value: "${process.env.RUNTIME_CACHE_TIMEOUT}". Using default: ${timeout}ms`
          );
        }
      }
      buildCacheInstance = new import_build_client.BuildCache({
        endpoint: RUNTIME_CACHE_ENDPOINT,
        headers: parsedHeaders,
        onError: (error) => console.error(error),
        timeout
      });
    }
    return buildCacheInstance;
  }
  var PkgCacheState = /* @__PURE__ */ ((PkgCacheState2) => {
    PkgCacheState2["Fresh"] = "fresh";
    PkgCacheState2["Stale"] = "stale";
    PkgCacheState2["Expired"] = "expired";
    PkgCacheState2["NotFound"] = "notFound";
    PkgCacheState2["Error"] = "error";
    return PkgCacheState2;
  })(PkgCacheState || {});
  const HEADERS_VERCEL_CACHE_STATE = "x-vercel-cache-state";
  const HEADERS_VERCEL_REVALIDATE = "x-vercel-revalidate";
  const HEADERS_VERCEL_CACHE_TAGS = "x-vercel-cache-tags";
  const HEADERS_VERCEL_CACHE_ITEM_NAME = "x-vercel-cache-item-name";
  return cache;
}
var dbConnections;
var hasRequiredDbConnections;
function requireDbConnections() {
  if (hasRequiredDbConnections) return dbConnections;
  hasRequiredDbConnections = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var db_connections_exports = {};
  __export(db_connections_exports, {
    attachDatabasePool: () => attachDatabasePool,
    experimental_attachDatabasePool: () => experimental_attachDatabasePool
  });
  dbConnections = __toCommonJS(db_connections_exports);
  var import_get_context = /* @__PURE__ */ requireGetContext();
  const DEBUG = !!process.env.DEBUG;
  function getIdleTimeout(dbPool) {
    if ("options" in dbPool && dbPool.options) {
      if ("idleTimeoutMillis" in dbPool.options) {
        return typeof dbPool.options.idleTimeoutMillis === "number" ? dbPool.options.idleTimeoutMillis : 1e4;
      }
      if ("maxIdleTimeMS" in dbPool.options) {
        return typeof dbPool.options.maxIdleTimeMS === "number" ? dbPool.options.maxIdleTimeMS : 0;
      }
      if ("status" in dbPool) {
        return 5e3;
      }
      if ("connect" in dbPool && "execute" in dbPool) {
        return 3e4;
      }
    }
    if ("config" in dbPool && dbPool.config) {
      if ("connectionConfig" in dbPool.config && dbPool.config.connectionConfig) {
        return dbPool.config.connectionConfig.idleTimeout || 6e4;
      }
      if ("idleTimeout" in dbPool.config) {
        return typeof dbPool.config.idleTimeout === "number" ? dbPool.config.idleTimeout : 6e4;
      }
    }
    if ("poolTimeout" in dbPool) {
      return typeof dbPool.poolTimeout === "number" ? dbPool.poolTimeout : 6e4;
    }
    if ("idleTimeout" in dbPool) {
      return typeof dbPool.idleTimeout === "number" ? dbPool.idleTimeout : 0;
    }
    return 1e4;
  }
  let idleTimeout = null;
  let idleTimeoutResolve = () => {
  };
  const bootTime = Date.now();
  const maximumDuration = 15 * 60 * 1e3 - 1e3;
  function waitUntilIdleTimeout(dbPool) {
    if (!process.env.VERCEL_URL || // This is not set during builds where we don't need to wait for idle connections using the mechanism
    !process.env.VERCEL_REGION) {
      return;
    }
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeoutResolve();
    }
    const promise = new Promise((resolve) => {
      idleTimeoutResolve = resolve;
    });
    const waitTime = Math.min(
      getIdleTimeout(dbPool) + 100,
      Math.max(100, maximumDuration - (Date.now() - bootTime))
    );
    idleTimeout = setTimeout(() => {
      idleTimeoutResolve?.();
      if (DEBUG) {
        console.log("Database pool idle timeout reached. Releasing connections.");
      }
    }, waitTime);
    const requestContext = (0, import_get_context.getContext)();
    if (requestContext?.waitUntil) {
      requestContext.waitUntil(promise);
    } else {
      console.warn("Pool release event triggered outside of request scope.");
    }
  }
  function attachDatabasePool(dbPool) {
    if (idleTimeout) {
      idleTimeoutResolve?.();
      clearTimeout(idleTimeout);
    }
    if ("on" in dbPool && dbPool.on && "options" in dbPool && "idleTimeoutMillis" in dbPool.options) {
      const pgPool = dbPool;
      pgPool.on("release", () => {
        if (DEBUG) {
          console.log("Client released from pool");
        }
        waitUntilIdleTimeout(dbPool);
      });
      return;
    } else if ("on" in dbPool && dbPool.on && "config" in dbPool && dbPool.config && "connectionConfig" in dbPool.config) {
      const mysqlPool = dbPool;
      mysqlPool.on("release", () => {
        if (DEBUG) {
          console.log("MySQL client released from pool");
        }
        waitUntilIdleTimeout(dbPool);
      });
      return;
    } else if ("on" in dbPool && dbPool.on && "config" in dbPool && dbPool.config && "idleTimeout" in dbPool.config) {
      const mysql2Pool = dbPool;
      mysql2Pool.on("release", () => {
        if (DEBUG) {
          console.log("MySQL2/MariaDB client released from pool");
        }
        waitUntilIdleTimeout(dbPool);
      });
      return;
    }
    if ("on" in dbPool && dbPool.on && "options" in dbPool && dbPool.options && "maxIdleTimeMS" in dbPool.options) {
      const mongoPool = dbPool;
      mongoPool.on("connectionCheckedOut", () => {
        if (DEBUG) {
          console.log("MongoDB connection checked out");
        }
        waitUntilIdleTimeout(dbPool);
      });
      return;
    }
    if ("on" in dbPool && dbPool.on && "options" in dbPool && dbPool.options && "socket" in dbPool.options) {
      const redisPool = dbPool;
      redisPool.on("end", () => {
        if (DEBUG) {
          console.log("Redis connection ended");
        }
        waitUntilIdleTimeout(dbPool);
      });
      return;
    }
    throw new Error("Unsupported database pool type");
  }
  const experimental_attachDatabasePool = attachDatabasePool;
  return dbConnections;
}
var purge;
var hasRequiredPurge;
function requirePurge() {
  if (hasRequiredPurge) return purge;
  hasRequiredPurge = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var purge_exports = {};
  __export(purge_exports, {
    dangerouslyDeleteBySrcImage: () => dangerouslyDeleteBySrcImage,
    dangerouslyDeleteByTag: () => dangerouslyDeleteByTag,
    invalidateBySrcImage: () => invalidateBySrcImage,
    invalidateByTag: () => invalidateByTag
  });
  purge = __toCommonJS(purge_exports);
  var import_get_context = /* @__PURE__ */ requireGetContext();
  const invalidateByTag = (tag) => {
    const api = (0, import_get_context.getContext)().purge;
    if (api) {
      return api.invalidateByTag(tag);
    }
    return Promise.resolve();
  };
  const dangerouslyDeleteByTag = (tag, options) => {
    const api = (0, import_get_context.getContext)().purge;
    if (api) {
      return api.dangerouslyDeleteByTag(tag, options);
    }
    return Promise.resolve();
  };
  const invalidateBySrcImage = (src) => {
    const api = (0, import_get_context.getContext)().purge;
    return api ? api.invalidateBySrcImage(src) : Promise.resolve();
  };
  const dangerouslyDeleteBySrcImage = (src, options) => {
    const api = (0, import_get_context.getContext)().purge;
    return api ? api.dangerouslyDeleteBySrcImage(src, options) : Promise.resolve();
  };
  return purge;
}
var addcachetag;
var hasRequiredAddcachetag;
function requireAddcachetag() {
  if (hasRequiredAddcachetag) return addcachetag;
  hasRequiredAddcachetag = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var addcachetag_exports = {};
  __export(addcachetag_exports, {
    addCacheTag: () => addCacheTag
  });
  addcachetag = __toCommonJS(addcachetag_exports);
  var import_get_context = /* @__PURE__ */ requireGetContext();
  const addCacheTag = (tag) => {
    const addCacheTag2 = (0, import_get_context.getContext)().addCacheTag;
    if (addCacheTag2) {
      return addCacheTag2(tag);
    }
    return Promise.resolve();
  };
  return addcachetag;
}
var functions;
var hasRequiredFunctions;
function requireFunctions() {
  if (hasRequiredFunctions) return functions;
  hasRequiredFunctions = 1;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var src_exports = {};
  __export(src_exports, {
    addCacheTag: () => import_addcachetag.addCacheTag,
    attachDatabasePool: () => import_db_connections.attachDatabasePool,
    dangerouslyDeleteBySrcImage: () => import_purge.dangerouslyDeleteBySrcImage,
    dangerouslyDeleteByTag: () => import_purge.dangerouslyDeleteByTag,
    experimental_attachDatabasePool: () => import_db_connections.experimental_attachDatabasePool,
    geolocation: () => import_headers.geolocation,
    getCache: () => import_cache.getCache,
    getEnv: () => import_get_env.getEnv,
    invalidateBySrcImage: () => import_purge.invalidateBySrcImage,
    invalidateByTag: () => import_purge.invalidateByTag,
    ipAddress: () => import_headers.ipAddress,
    next: () => import_middleware.next,
    rewrite: () => import_middleware.rewrite,
    waitUntil: () => import_wait_until.waitUntil
  });
  functions = __toCommonJS(src_exports);
  var import_headers = /* @__PURE__ */ requireHeaders();
  var import_get_env = /* @__PURE__ */ requireGetEnv();
  var import_wait_until = /* @__PURE__ */ requireWaitUntil();
  var import_middleware = /* @__PURE__ */ requireMiddleware();
  var import_cache = /* @__PURE__ */ requireCache();
  var import_db_connections = /* @__PURE__ */ requireDbConnections();
  var import_purge = /* @__PURE__ */ requirePurge();
  var import_addcachetag = /* @__PURE__ */ requireAddcachetag();
  return functions;
}
var functionsExports = /* @__PURE__ */ requireFunctions();
export {
  functionsExports as f
};
