import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "just-bash - A sandboxed bash interpreter for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASCII_ART = `   _           _   _               _
  (_)_   _ ___| |_| |__   __ _ ___| |__
  | | | | / __| __| '_ \\ / _\` / __| '_ \\
  | | |_| \\__ \\ |_| |_) | (_| \\__ \\ | | |
 _/ |\\__,_|___/\\__|_.__/ \\__,_|___/_| |_|
|__/`;

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#000",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          padding: "60px",
        }}
      >
        <pre
          style={{
            color: "#fff",
            fontSize: "32px",
            lineHeight: "1.2",
            margin: 0,
            whiteSpace: "pre",
          }}
        >
          {ASCII_ART}
        </pre>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: "40px",
            gap: "16px",
          }}
        >
          <div
            style={{
              color: "#888",
              fontSize: "28px",
            }}
          >
            A sandboxed bash interpreter for AI agents
          </div>
          <div
            style={{
              color: "#22d3ee",
              fontSize: "36px",
              fontWeight: "bold",
            }}
          >
            npm install just-bash
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            color: "#666",
            fontSize: "20px",
          }}
        >
          Pure TypeScript • In-memory filesystem • No WASM
        </div>
      </div>
    ),
    { ...size }
  );
}
