import localFont from "next/font/local";

// Local fonts keep the build offline-friendly inside the sandbox and avoid
// network fetches during `next build`.
export const inter = localFont({
  src: [
    { path: "../../../fonts/dm-sans-latin.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const instrumentSerif = localFont({
  src: [
    { path: "../../../fonts/space-grotesk-latin.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const instrumentSerifItalic = localFont({
  src: [
    { path: "../../../fonts/space-grotesk-latin.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-instrument-serif-italic",
  display: "swap",
});
