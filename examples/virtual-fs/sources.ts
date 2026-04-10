/**
 * Virtual filesystem sources for the demo
 *
 * Simulated data providers — no external dependencies.
 */

import { defineVirtualFs } from "just-bash";

// ── Report database ─────────────────────────────────────────

interface Report {
  id: string;
  content: string;
}

const REPORTS_DB: Record<string, Report[]> = {
  alice: [
    {
      id: "sprint-23",
      content: [
        "# Sprint 23 — Platform Stability",
        "",
        "## Completed",
        "- [x] Add retry logic to payment gateway",
        "- [x] Upgrade Nextjs to 16.0.7",
        "",
        "## Metrics",
        "- Uptime: 99.97%",
        "- ERROR count: 3",
        "- WARN count: 12",
        "- P95 latency: 120ms",
        "",
      ].join("\n"),
    },
    {
      id: "sprint-24",
      content: [
        "# Sprint 24 — API Migration",
        "",
        "## Completed",
        "- [x] Migrate /v1/users to /v2/users",
        "- [x] Add rate limiting to public endpoints",
        "- [ ] Update SDK documentation",
        "",
        "## Metrics",
        "- Uptime: 99.91%",
        "- ERROR count: 17",
        "- WARN count: 45",
        "- P95 latency: 340ms",
        "",
        "## Incidents",
        "- 2024-03-15: ERROR — Database failover during peak",
        "- 2024-03-18: ERROR — Rate limiter misconfiguration (503s)",
        "",
      ].join("\n"),
    },
    {
      id: "sprint-25",
      content: [
        "# Sprint 25 — Observability",
        "",
        "## Completed",
        "- [x] Deploy distributed tracing",
        "- [x] Add custom metrics",
        "",
        "## Metrics",
        "- Uptime: 99.99%",
        "- ERROR count: 1",
        "- WARN count: 8",
        "- P95 latency: 95ms",
        "",
        "## Notes",
        "- Trace coverage: 87% of endpoints",
        "- Alert noise reduced by 60%",
        "",
      ].join("\n"),
    },
  ],
};

/**
 * Simulates a report database.
 * Files are generated from in-memory records, as if fetched from a DB.
 * Write hooks allow the shell to create, update and delete reports.
 */
export const reportDbSource = defineVirtualFs(
  (opts: { userId: string }) => {
    const reports = REPORTS_DB[opts.userId] ?? [];

    return {
      async readFile(path: string) {
        const id = path.slice(1);
        const report = reports.find((r) => r.id === id);
        return report?.content ?? null;
      },
      async readdir(path: string) {
        if (path === "/") {
          return reports.map((r) => ({
            name: r.id,
            isFile: true,
            isDirectory: false,
          }));
        }
        return null;
      },

      async writeFile(path: string, content) {
        const id = path.slice(1);
        const existing = reports.find((r) => r.id === id);
        if (existing) {
          existing.content = String(content);
        } else {
          reports.push({ id, content: String(content) });
        }
      },

      async rm(path: string) {
        const id = path.slice(1);
        const idx = reports.findIndex((r) => r.id === id);
        if (idx === -1) {
          throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
        }
        reports.splice(idx, 1);
      },

      async appendFile(path: string, content) {
        const id = path.slice(1);
        const existing = reports.find((r) => r.id === id);
        if (existing) {
          existing.content += String(content);
        } else {
          reports.push({ id, content: String(content) });
        }
      },
    };
  },
);

// ── Metrics API ─────────────────────────────────────────────

interface NodeMetrics {
  cpu: number;
  memory: number;
  loadAvg: [number, number, number];
  totalMemoryGb: number;
  status: "healthy" | "warning" | "critical";
}

const CLUSTER_NODES: Record<string, Record<string, NodeMetrics>> = {
  production: {
    "node-1": {
      cpu: 45.2,
      memory: 72.1,
      loadAvg: [2.1, 1.8, 1.5],
      totalMemoryGb: 32,
      status: "healthy",
    },
    "node-2": {
      cpu: 89.7,
      memory: 91.3,
      loadAvg: [14.2, 13.1, 12.8],
      totalMemoryGb: 64,
      status: "critical",
    },
    "node-3": {
      cpu: 23.1,
      memory: 55.8,
      loadAvg: [0.9, 0.7, 0.5],
      totalMemoryGb: 16,
      status: "healthy",
    },
  },
};

/**
 * Simulates a monitoring API.
 * Directory tree and file content are computed from live metrics.
 *
 * Tree:
 *   /status.json
 *   /cpu/<node>.txt
 *   /memory/<node>.txt
 */
export const metricsApiSource = defineVirtualFs(
  (opts: { cluster: string }) => {
    const nodes = CLUSTER_NODES[opts.cluster] ?? {};
    const nodeNames = Object.keys(nodes);

    return {
      async readFile(path: string) {
        if (path === "/status.json") {
          const summary = nodeNames.map((name) => ({
            node: name,
            status: nodes[name].status,
            cpu: nodes[name].cpu,
            memory: nodes[name].memory,
          }));
          return (
            JSON.stringify(
              { cluster: opts.cluster, nodes: summary },
              null,
              2,
            ) + "\n"
          );
        }

        const match = path.match(
          /^\/(cpu|memory)\/(.+)\.txt$/,
        );
        if (match) {
          const [, metric, nodeName] = match;
          const m = nodes[nodeName];
          if (!m) return null;

          if (metric === "cpu") {
            return [
              `usage: ${m.cpu}%`,
              `load_avg: ${m.loadAvg.join(" ")}`,
              `status: ${m.status}`,
              "",
            ].join("\n");
          }
          if (metric === "memory") {
            const availableGb =
              m.totalMemoryGb * (1 - m.memory / 100);
            return [
              `used: ${m.memory}%`,
              `total_gb: ${m.totalMemoryGb}`,
              `available_gb: ${availableGb.toFixed(1)}`,
              `status: ${m.status}`,
              "",
            ].join("\n");
          }
        }

        return null;
      },

      async readdir(path: string) {
        if (path === "/") {
          return [
            { name: "cpu", isFile: false, isDirectory: true },
            { name: "memory", isFile: false, isDirectory: true },
            {
              name: "status.json",
              isFile: true,
              isDirectory: false,
            },
          ];
        }
        if (path === "/cpu" || path === "/memory") {
          return nodeNames.map((name) => ({
            name: `${name}.txt`,
            isFile: true,
            isDirectory: false,
          }));
        }
        return null;
      },
    };
  },
);
