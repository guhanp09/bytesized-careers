"use client";

import React from "react";

export function Icon({
  name,
  className = "w-4 h-4",
}: {
  name:
    | "menu"
    | "home"
    | "search"
    | "mic"
    | "plus"
    | "user"
    | "bell"
    | "bell-yt"
    | "briefcase"
    | "pin"
    | "share"
    | "bookmark"
    | "tag"
    | "eye"
    | "image"
    | "clock"
    | "users"
    | "bolt"
    | "cap"
    | "send"
    | "circle-play"
    | "inbox"
    | "mail"
    | "youtube"
    | "check"
    | "alert"
    | "globe"
    | "help"
    | "cash"
    | "cash-stack"
    | "log-out"
    | "log-in"
    | "user-plus"
    | "pencil"
    | "file"
    | "settings"
    | "external-link"
    | "instagram"
    | "tiktok"
    | "facebook"
    | "linkedin"
    | "x"
    | "podcast"
    | "more"
    | "pause"
    | "archive"
    | "copy"
    | "trash";
  className?: string;
}) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8 };

  switch (name) {
    case "menu":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );

    case "home":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M3 11.5L12 4l9 7.5" />
          <path strokeLinecap="round" d="M5 21V10h14v11" />
        </svg>
      );

    case "search":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M21 21l-4.2-4.2" />
          <circle cx="11" cy="11" r="7" />
        </svg>
      );

    case "mic":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z"
          />
          <path strokeLinecap="round" d="M19 11a7 7 0 0 1-14 0" />
          <path strokeLinecap="round" d="M12 18v3" />
        </svg>
      );

    case "plus":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
      );

    case "user":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="8" r="3.2" />
          <path strokeLinecap="round" d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );

    case "bell":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            d="M6 9a6 6 0 1 1 12 0c0 4 1.2 5.2 2 6H4c.8-.8 2-2 2-6Z"
          />
          <path strokeLinecap="round" d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );

    case "bell-yt":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.5 9.5a5.5 5.5 0 1 1 11 0c0 3.9 1.2 5.1 2 6H4.5c.8-.9 2-2.1 2-6Z"
          />
          <path strokeLinecap="round" d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );

    case "briefcase":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M9 6V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
          <path strokeLinecap="round" d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
          <path strokeLinecap="round" d="M4 12h16" />
        </svg>
      );

    case "pin":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            d="M12 21s7-4.5 7-11a7 7 0 0 0-14 0c0 6.5 7 11 7 11Z"
          />
          <path strokeLinecap="round" d="M12 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        </svg>
      );

    case "share":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M8 12l8-4" />
          <path strokeLinecap="round" d="M8 12l8 4" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
        </svg>
      );

    case "bookmark":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            d="M7 4h10a1 1 0 0 1 1 1v16l-6-3-6 3V5a1 1 0 0 1 1-1Z"
          />
        </svg>
      );

    case "tag":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M20 13l-7 7a2 2 0 0 1-2.8 0L3 12V4h8l9 9Z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );

    case "eye":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
          />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      );

    case "image":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m7 16 3.2-3.2a1.2 1.2 0 0 1 1.7 0L15 16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m14 15 1.2-1.2a1.2 1.2 0 0 1 1.7 0L20 17" />
          <circle cx="9" cy="9" r="1.2" />
        </svg>
      );

    case "clock":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" d="M12 7v5l3 2" />
        </svg>
      );

    case "users":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M16 19c0-2.2-2-4-4-4s-4 1.8-4 4" />
          <circle cx="12" cy="9.5" r="2.5" />
          <path strokeLinecap="round" d="M19 19c0-1.7-1.3-3.1-3-3.6" />
          <path strokeLinecap="round" d="M8 15.4C6.3 15.9 5 17.3 5 19" />
        </svg>
      );

    case "bolt":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M13 2L4 14h7l-1 8 10-14h-7l0-6Z" />
        </svg>
      );

    case "cap":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.5 9.5 12 5l8.5 4.5L12 14 3.5 9.5Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.5 11.2V15c0 .8.4 1.5 1.1 1.9 1.3.8 3.1 1.6 4.4 1.6s3.1-.8 4.4-1.6c.7-.4 1.1-1.1 1.1-1.9v-3.8"
          />
          <path strokeLinecap="round" d="M20.5 10v5" />
        </svg>
      );

    case "send":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M22 2 11 13" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M22 2 15 22l-4-9-9-4 20-7Z" />
        </svg>
      );

    case "circle-play":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 8.8 5 3.2-5 3.2V8.8Z" />
        </svg>
      );

    case "inbox":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 5h16v14H4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 13h4l2 3h4l2-3h4" />
        </svg>
      );

    case "mail":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 7 7.5 6 7.5-6" />
        </svg>
      );

    case "help":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" d="M9.8 9.2a2.4 2.4 0 1 1 3.8 2c-.9.6-1.6 1.1-1.6 2.3" />
          <path strokeLinecap="round" d="M12 16.8h.01" />
        </svg>
      );

    case "cash":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="3" />
          <path strokeLinecap="round" d="M7 9.5h.01M17 14.5h.01" />
        </svg>
      );

    case "cash-stack":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="10" rx="2" />
          <rect x="6" y="9" width="14" height="10" rx="2" />
          <circle cx="13" cy="14" r="2.5" />
        </svg>
      );

    case "instagram":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <circle cx="12" cy="12" r="3.2" />
          <circle cx="17" cy="7" r="1" />
        </svg>
      );

    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M12 7v9a3 3 0 1 1-2-2.8" />
          <path strokeLinecap="round" d="M12 7c1.2 1.6 2.6 2.6 4.5 2.8" />
        </svg>
      );

    case "facebook":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M14 8h2V5h-2c-2 0-4 1.5-4 4v2H8v3h2v5h3v-5h2l1-3h-3V9c0-.6.4-1 1-1Z" />
        </svg>
      );

    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path strokeLinecap="round" d="M8 10v6" />
          <path strokeLinecap="round" d="M8 8h.01" />
          <path strokeLinecap="round" d="M12 16v-4a2 2 0 0 1 4 0v4" />
        </svg>
      );

    case "x":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M6 5l12 14M18 5L6 19" />
        </svg>
      );

    case "podcast":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="3" />
          <path strokeLinecap="round" d="M5 12a7 7 0 0 1 14 0" />
          <path strokeLinecap="round" d="M8 12a4 4 0 0 1 8 0" />
          <path strokeLinecap="round" d="M12 15v4" />
        </svg>
      );

    // ✅ NEW: YouTube / play badge icon for hover overlay on reference videos
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.6 8.2a3 3 0 0 0-2.1-2.1C17.9 5.6 12 5.6 12 5.6s-5.9 0-7.5.5A3 3 0 0 0 2.4 8.2 31.5 31.5 0 0 0 2 12a31.5 31.5 0 0 0 .4 3.8 3 3 0 0 0 2.1 2.1c1.6.5 7.5.5 7.5.5s5.9 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 22 12a31.5 31.5 0 0 0-.4-3.8Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.2 9.6 15.2 12l-5 2.4V9.6Z" />
        </svg>
      );

    case "check":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l4 4L19 6" />
        </svg>
      );

    case "alert":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3.5 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3.5Z"
          />
          <path strokeLinecap="round" d="M12 9v4" />
          <path strokeLinecap="round" d="M12 17h.01" />
        </svg>
      );

    case "globe":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" d="M4 12h16" />
          <path strokeLinecap="round" d="M12 4a12 12 0 0 0 0 16" />
          <path strokeLinecap="round" d="M12 4a12 12 0 0 1 0 16" />
        </svg>
      );

    case "log-out":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M9 4h6a2 2 0 0 1 2 2v3" />
          <path strokeLinecap="round" d="M15 20H9a2 2 0 0 1-2-2v-3" />
          <path strokeLinecap="round" d="M12 12h9" />
          <path strokeLinecap="round" d="M18 9l3 3-3 3" />
        </svg>
      );

    case "log-in":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M15 4h-6a2 2 0 0 0-2 2v3" />
          <path strokeLinecap="round" d="M7 20h6a2 2 0 0 0 2-2v-3" />
          <path strokeLinecap="round" d="M12 12H3" />
          <path strokeLinecap="round" d="M6 9l-3 3 3 3" />
        </svg>
      );

    case "user-plus":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="9" cy="8" r="3" />
          <path strokeLinecap="round" d="M3 19a6 6 0 0 1 12 0" />
          <path strokeLinecap="round" d="M19 8v6" />
          <path strokeLinecap="round" d="M16 11h6" />
        </svg>
      );

    case "pencil":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 20h4l10-10-4-4L4 16v4Z" />
          <path strokeLinecap="round" d="m12 6 4 4" />
        </svg>
      );

    case "more":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      );

    case "pause":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M9 5v14M15 5v14" />
        </svg>
      );

    case "archive":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M5 8l1.2-2.6A1 1 0 0 1 7.1 5h9.8a1 1 0 0 1 .9.5L19 8M10 12h4" />
        </svg>
      );

    case "copy":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1" />
        </svg>
      );

    case "trash":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 7h16" />
          <path strokeLinecap="round" d="M10 11v6M14 11v6" />
          <path strokeLinecap="round" d="M6 7l1 13h10l1-13" />
          <path strokeLinecap="round" d="M9 7V4h6v3" />
        </svg>
      );

    case "file":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
          <path strokeLinecap="round" d="M9 13h6M9 17h6" />
        </svg>
      );

    case "settings":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="2.5" />
          <path
            strokeLinecap="round"
            d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1.8 1.8 0 1 1-3.6 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1.8 1.8 0 1 1 0-3.6h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1.8 1.8 0 1 1 3.6 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1.8 1.8 0 1 1 0 3.6h-.2a1 1 0 0 0-.9.6Z"
          />
        </svg>
      );

    case "external-link":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M14 5h5v5" />
          <path strokeLinecap="round" d="M19 5 10 14" />
          <path strokeLinecap="round" d="M19 14v4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
        </svg>
      );
  }
}
