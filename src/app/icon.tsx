import { ImageResponse } from "next/og";

// The ConvoReal mark — a gable roof and a chat bubble in one silhouette,
// with the reply bar in Signal Gold. Source artwork and usage rules live
// in `public/brand/` and `docs/marketing/brand-guidelines.html`; this is
// the 32px favicon variant with thickened bars so both survive the pixel
// grid. Next.js renders it at build time and injects <link rel="icon">.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7C3AED",
          borderRadius: 7,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 64 64">
          <path
            fill="#FFFFFF"
            d="M 34.6 7.2 L 55.2 23.6 Q 57 25.1 57 27.6 L 57 43 Q 57 52 48 52 L 20 52 L 8.6 60.8 Q 7 62 7 59.6 L 7 27.6 Q 7 25.1 8.8 23.6 L 29.4 7.2 Q 32 5 34.6 7.2 Z"
          />
          <path
            fill="#7C3AED"
            d="M 19 27.5 L 39 27.5 A 3.75 3.75 0 0 1 39 35 L 19 35 A 3.75 3.75 0 0 1 19 27.5 Z"
          />
          <path
            fill="#F5C044"
            d="M 27 40 L 45 40 A 3.75 3.75 0 0 1 45 47.5 L 27 47.5 A 3.75 3.75 0 0 1 27 40 Z"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
