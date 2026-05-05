import { ImageResponse } from 'next/og'

export const alt = 'just-bash - A sandboxed bash interpreter for AI agents'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ASCII_ART = `   _           _   _               _
  (_)_   _ ___| |_| |__   __ _ ___| |__
  | | | | / __| __| '_ \\ / _\` / __| '_ \\
  | | |_| \\__ \\ |_| |_) | (_| \\__ \\ | | |
 _/ |\\__,_|___/\\__|_.__/ \\__,_|___/_| |_|
|__/`

export default async function Image() {
  const font = await fetch(new URL('https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n5ig.ttf')).then((res) => res.arrayBuffer())

  return new ImageResponse(
    <div
      style={{
        background: '#000',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        fontFamily: 'IBM Plex Mono',
        padding: '60px 200px',
      }}
    >
      <pre
        style={{
          color: '#fff',
          fontSize: '32px',
          lineHeight: '1.2',
          margin: 0,
          whiteSpace: 'pre',
        }}
      >
        {ASCII_ART}
      </pre>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          marginTop: '40px',
          gap: '12px',
        }}
      >
        <div
          style={{
            color: '#7d7d7d',
            fontSize: '31px',
            lineHeight: '1.2',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          A sandboxed bash interpreter for AI agents.
          <br />
          Pure TypeScript with in-memory filesystem.
        </div>
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '20px',
            fontSize: '31px',
            lineHeight: '1.2',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            flexGrow: 1,
            width: '800px',
          }}
        >
          <span style={{ color: '#FFF' }}>$</span>
          <span
            style={{
              color: '#0AC5B3',
              fontSize: '31px',
            }}
          >
            npm install just-bash
          </span>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: 'IBM Plex Mono',
          data: font,
          style: 'normal',
        },
      ],
    },
  )
}
