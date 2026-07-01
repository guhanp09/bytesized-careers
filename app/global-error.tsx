"use client";

import { useEffect } from "react";

// global-error replaces the root layout when the layout itself throws, so the
// global stylesheet is not applied here. Keep everything inline-styled so the
// fallback still looks intentional and on-brand.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0b0b0f",
          color: "#ffffff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: "420px", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: "0 0 10px",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "14px",
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.55)",
              margin: "0 0 22px",
            }}
          >
            CreatorJobs hit an unexpected error. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              height: "40px",
              padding: "0 18px",
              borderRadius: "12px",
              border: "none",
              backgroundColor: "#ffffff",
              color: "#000000",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
