import { m as ms } from "../ms.mjs";
import { readdir, readlink, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
function pluralize(singular, plural, count) {
  return count === 1 ? singular : plural;
}
function withResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}
function once(fn) {
  const result = {
    get value() {
      const value = fn();
      Object.defineProperty(result, "value", { value });
      return value;
    }
  };
  return result;
}
function parseDurationToDate(param) {
  if (typeof param === "string") {
    const durationMs = ms(param);
    if (typeof durationMs !== "number" || durationMs < 0) {
      throw new Error(`Invalid duration: "${param}". Expected a valid duration string like "1s", "1m", "1h", etc.`);
    }
    return new Date(Date.now() + durationMs);
  } else if (typeof param === "number") {
    if (param < 0 || !Number.isFinite(param)) {
      throw new Error(`Invalid duration: ${param}. Expected a non-negative finite number of milliseconds.`);
    }
    return new Date(Date.now() + param);
  } else if (param instanceof Date || param && typeof param === "object" && typeof param.getTime === "function") {
    return param instanceof Date ? param : new Date(param.getTime());
  } else {
    throw new Error(`Invalid duration parameter. Expected a duration string, number (milliseconds), or Date object.`);
  }
}
const execFileAsync = promisify(execFile);
function parsePort(value, radix = 10) {
  const port = parseInt(value, radix);
  if (!Number.isNaN(port) && port >= 0 && port <= 65535) {
    return port;
  }
  return void 0;
}
const join = (arr, sep) => arr.join(sep);
const PROC_ROOT = join(["", "proc"], "/");
async function getLinuxPorts(pid) {
  const listenState = "0A";
  const tcpFiles = [`${PROC_ROOT}/net/tcp`, `${PROC_ROOT}/net/tcp6`];
  const socketInodes = [];
  const socketInodesSet = /* @__PURE__ */ new Set();
  const fdPath = `${PROC_ROOT}/${pid}/fd`;
  try {
    const fds = await readdir(fdPath);
    const sortedFds = fds.sort((a, b) => {
      const numA = Number.parseInt(a, 10);
      const numB = Number.parseInt(b, 10);
      return numA - numB;
    });
    const results = await Promise.allSettled(sortedFds.map(async (fd) => {
      const link = await readlink(`${fdPath}/${fd}`);
      const match = link.match(/^socket:\[(\d+)\]$/);
      return match?.[1] ?? null;
    }));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        socketInodes.push(result.value);
        socketInodesSet.add(result.value);
      }
    }
  } catch {
    return [];
  }
  if (socketInodes.length === 0) {
    return [];
  }
  const inodeToPort = /* @__PURE__ */ new Map();
  for (const tcpFile of tcpFiles) {
    try {
      const content = await readFile(tcpFile, "utf8");
      const lines = content.split("\n").slice(1);
      for (const line of lines) {
        if (!line.trim())
          continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10)
          continue;
        const localAddr = parts[1];
        const state = parts[3];
        const inode = parts[9];
        if (!localAddr || state !== listenState || !inode)
          continue;
        if (!socketInodesSet.has(inode))
          continue;
        const colonIndex = localAddr.indexOf(":");
        if (colonIndex === -1)
          continue;
        const portHex = localAddr.slice(colonIndex + 1);
        if (!portHex)
          continue;
        const port = parsePort(portHex, 16);
        if (port !== void 0) {
          inodeToPort.set(inode, port);
        }
      }
    } catch {
      continue;
    }
  }
  const ports = [];
  for (const inode of socketInodes) {
    const port = inodeToPort.get(inode);
    if (port !== void 0) {
      ports.push(port);
    }
  }
  return ports;
}
async function getDarwinPorts(pid) {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-a",
      "-i",
      "-P",
      "-n",
      "-p",
      pid.toString()
    ]);
    const ports = [];
    const lines = stdout.split("\n");
    for (const line of lines) {
      if (line.includes("LISTEN")) {
        const parts = line.trim().split(/\s+/);
        const addr = parts[8];
        if (addr) {
          const colonIndex = addr.lastIndexOf(":");
          if (colonIndex !== -1) {
            const port = parsePort(addr.slice(colonIndex + 1));
            if (port !== void 0) {
              ports.push(port);
            }
          }
        }
      }
    }
    return ports;
  } catch {
    return [];
  }
}
async function getWindowsPorts(pid) {
  try {
    const { stdout } = await execFileAsync("cmd", [
      "/c",
      `netstat -ano | findstr ${pid} | findstr LISTENING`
    ]);
    const ports = [];
    const trimmedOutput = stdout.trim();
    if (trimmedOutput) {
      const lines = trimmedOutput.split("\n");
      for (const line of lines) {
        const match = line.trim().match(/^\s*TCP\s+(?:\[[\da-f:]+\]|[\d.]+):(\d+)\s+/i);
        if (match) {
          const port = parsePort(match[1]);
          if (port !== void 0) {
            ports.push(port);
          }
        }
      }
    }
    return ports;
  } catch {
    return [];
  }
}
async function getAllPorts() {
  const { pid, platform } = process;
  try {
    switch (platform) {
      case "linux":
        return await getLinuxPorts(pid);
      case "darwin":
        return await getDarwinPorts(pid);
      case "win32":
        return await getWindowsPorts(pid);
      default:
        return [];
    }
  } catch (error) {
    return [];
  }
}
async function getPort() {
  const ports = await getAllPorts();
  return ports[0];
}
const PROBE_TIMEOUT_MS = 500;
const PROBE_ENDPOINT = "/.well-known/workflow/v1/flow?__health";
async function probePort(port, options = {}) {
  const { endpoint = PROBE_ENDPOINT, timeout = PROBE_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`http://localhost:${port}${endpoint}`, {
      method: "HEAD",
      signal: controller.signal
    });
    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
async function getWorkflowPort(options) {
  const ports = await getAllPorts();
  if (ports.length === 0) {
    return void 0;
  }
  if (ports.length === 1) {
    return ports[0];
  }
  const probeResults = await Promise.all(ports.map(async (port) => ({
    port,
    isWorkflow: await probePort(port, options)
  })));
  const workflowPort = probeResults.find((r) => r.isWorkflow);
  if (workflowPort) {
    return workflowPort.port;
  }
  return ports[0];
}
export {
  pluralize as a,
  getWorkflowPort as b,
  getPort as g,
  once as o,
  parseDurationToDate as p,
  withResolvers as w
};
