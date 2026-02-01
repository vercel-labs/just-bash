import { ImageResponse } from "next/og";

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
  const font = await fetch(
    new URL("https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n5ig.ttf")
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          background: "#000",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          fontFamily: "IBM Plex Mono",
          padding: "60px 80px",
        }}
      >
<pre
          style={{
            color: "#fff",
            fontSize: "28px",
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
            alignItems: "flex-start",
            marginTop: "40px",
            gap: "12px",
          }}
        >
          <div
            style={{
              color: "#888",
              fontSize: "24px",
            }}
          >
            A sandboxed bash interpreter for AI agents
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            <span style={{ color: "#666" }}>$</span>
            <span
              style={{
                color: "#0AC5B3",
                fontSize: "32px",
              }}
            >
              npm install just-bash
            </span>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "50px",
            left: "80px",
            color: "#555",
            fontSize: "18px",
          }}
        >
          Pure TypeScript | In-memory filesystem
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "IBM Plex Mono",
          data: font,
          style: "normal",
        },
      ],
    }
  );
}
