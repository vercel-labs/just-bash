import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
