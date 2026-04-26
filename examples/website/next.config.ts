import type { NextConfig } from "next";

// Content Security Policy
// - 'unsafe-inline' is required for Next.js inline scripts and styles
// - vercel.live is for the Vercel toolbar on preview deployments
// - va.vercel-scripts.com is for Vercel Analytics
// - *.pusher.com is for Vercel toolbar real-time features
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://vercel.live;
  style-src 'self' 'unsafe-inline' https://vercel.live;
  img-src 'self' data: blob: https://vercel.live https://vercel.com https://*.vercel.com;
  font-src 'self' https://vercel.live https://assets.vercel.com;
  connect-src 'self' https://vercel.live wss://*.pusher.com https://va.vercel-scripts.com;
  frame-src 'self' https://vercel.live;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`
  .replace(/\n/g, " ")
  .trim();

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "just-bash",
    // just-bash externalizes these in its own bundle; mark them external
    // here so turbopack doesn't try to bundle the native binaries when it
    // resolves the workspace-linked just-bash.
    "@mongodb-js/zstd",
    "node-liblzma",
    "seek-bzip",
    "sql.js",
    "quickjs-emscripten",
  ],
  outputFileTracingIncludes: {
    "/api/agent": ["./app/api/agent/_agent-data/**/*"],
    "/api/fs": ["./app/api/agent/_agent-data/**/*"],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: cspHeader },
      ],
    },
  ],
  rewrites: async () => {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/md/README.md",
          has: [
            {
              type: "header",
              key: "accept",
              value: "(.*)text/markdown(.*)",
            },
          ],
        },
        {
          source: "/:path*",
          destination: "/md/:path*",
          has: [
            {
              type: "header",
              key: "accept",
              value: "(.*)text/markdown(.*)",
            },
          ],
        },
      ],
    };
  }
};

export default nextConfig;
