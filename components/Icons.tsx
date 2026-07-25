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
    | "chevron-left"
    | "chevron-right"
    | "briefcase"
    | "screen"
    | "laptop"
    | "pin"
    | "share"
    | "bookmark"
    | "tag"
    | "eye"
    | "image"
    | "images"
    | "video"
    | "clock"
    | "timer-reset"
    | "calendar"
    | "calendar-clock"
    | "calendar-check"
    | "languages"
    | "sparkles"
    | "layers"
    | "layout-grid"
    | "list-checks"
    | "clipboard-check"
    | "clipboard-list"
    | "message-text"
    | "message-square-text"
    | "message-square-plus"
    | "notebook-text"
    | "sliders-horizontal"
    | "users"
    | "bolt"
    | "cap"
    | "send"
    | "circle-play"
    | "inbox"
    | "arrow-down-left"
    | "arrow-up-right"
    | "mail"
    | "youtube"
    | "check"
    | "close"
    | "shield"
    | "badge-check"
    | "trending-up"
    | "alert"
    | "globe"
    | "help"
    | "cash"
    | "cash-stack"
    | "wallet"
    | "indian-rupee"
    | "refresh"
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

    case "screen":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="12" rx="2" />
          <path strokeLinecap="round" d="M9 20h6M12 17v3" />
          <path strokeLinecap="round" d="M8 9h4" />
        </svg>
      );

    case "laptop":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M5 6h14v10H5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 19h18l-2-3H5l-2 3Z" />
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

    case "images":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="7" y="6" width="13" height="12" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16V8a2 2 0 0 1 2-2h1" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m10 15 2.6-2.6a1 1 0 0 1 1.4 0L17 15" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m16 14 1-1a1 1 0 0 1 1.4 0l1.6 1.6" />
          <circle cx="12" cy="10" r="1" />
        </svg>
      );

    case "video":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="6.5" width="11" height="11" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 10 5-3v10l-5-3" />
        </svg>
      );

    case "clock":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="8" />
          <path strokeLinecap="round" d="M12 7v5l3 2" />
        </svg>
      );

    case "timer-reset":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M10 2h4M12 8v5l3 2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.2 9A8 8 0 1 1 12 5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 5v4h-4" />
        </svg>
      );

    case "calendar":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path strokeLinecap="round" d="M8 3v4M16 3v4M4 10h16" />
          <path strokeLinecap="round" d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
        </svg>
      );

    case "calendar-clock":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path strokeLinecap="round" d="M8 3v4M16 3v4M4 10h16" />
          <circle cx="15" cy="15" r="3" />
          <path strokeLinecap="round" d="M15 13.5V15l1.1.8" />
        </svg>
      );

    case "calendar-check":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path strokeLinecap="round" d="M8 3v4M16 3v4M4 10h16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 15 2 2 4-5" />
        </svg>
      );

    case "languages":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 5h9M9 5v3M6 9c1.2 2.1 3.2 3.8 6 5" />
          <path strokeLinecap="round" d="M12 9c-.9 1.8-2.8 3.8-6 5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m14 20 3.5-8 3.5 8M15.3 17h4.4" />
        </svg>
      );

    case "sparkles":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9L12 3Z" />
          <path strokeLinecap="round" d="M5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15ZM18 4l.5 1.5L20 6l-1.5.5L18 8l-.5-1.5L16 6l1.5-.5L18 4Z" />
        </svg>
      );

    case "layers":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4 3 9l9 5 9-5-9-5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 7 4 7-4M5 17l7 4 7-4" />
        </svg>
      );

    case "layout-grid":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      );

    case "list-checks":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 1.5 1.5L8 5.5M4 14l1.5 1.5L8 12.5" />
          <path strokeLinecap="round" d="M11 7h9M11 15h9" />
        </svg>
      );

    case "clipboard-check":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M9 4h6" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5a2 2 0 0 0-2 2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1a2 2 0 0 0-2-2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 14 2 2 4-5" />
        </svg>
      );

    case "clipboard-list":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M9 4h6" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5a2 2 0 0 0-2 2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1a2 2 0 0 0-2-2" />
          <path strokeLinecap="round" d="M8 12h.01M11 12h5M8 16h.01M11 16h5" />
        </svg>
      );

    case "message-text":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2Z" />
          <path strokeLinecap="round" d="M8 10h8M8 14h5" />
        </svg>
      );

    case "message-square-text":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2Z" />
          <path strokeLinecap="round" d="M8 10h8M8 14h6" />
        </svg>
      );

    case "message-square-plus":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2Z" />
          <path strokeLinecap="round" d="M12 9v6M9 12h6" />
        </svg>
      );

    case "notebook-text":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
          <path strokeLinecap="round" d="M8 8h7M8 12h8M8 16h5M7 4v16" />
        </svg>
      );

    case "sliders-horizontal":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M4 7h5M15 7h5M4 17h9M19 17h1" />
          <circle cx="12" cy="7" r="3" />
          <circle cx="16" cy="17" r="3" />
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

    /* Relationship direction, used as a small mark on the inbox avatar: an
       arrow into the corner for something that arrived, out of it for
       something sent. Always paired with an accessible name. */
    case "arrow-down-left":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 7 7 17m0 0h7m-7 0v-7" />
        </svg>
      );
    case "arrow-up-right":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7m0 0h-7m7 0v7" />
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

    case "wallet":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M5 7.5h12.5A2.5 2.5 0 0 1 20 10v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11" />
          <path strokeLinecap="round" d="M16 12h4" />
          <circle cx="16" cy="14.5" r="1" />
        </svg>
      );

    case "indian-rupee":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" d="M7 5h10M7 9h10M8 5c3.8 0 6 1.5 6 4.2S11.8 14 8 14h-.8L15 21" />
        </svg>
      );

    case "refresh":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5" />
          <path strokeLinecap="round" d="M19.2 12a7.2 7.2 0 1 1-2-5" />
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

    case "chevron-left":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
      );

    case "chevron-right":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
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

    case "close":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      );

    case "shield":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3l7 3v5c0 4.2-2.9 7.4-7 8.5-4.1-1.1-7-4.3-7-8.5V6l7-3z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 11.5l2 2 4-4" />
        </svg>
      );

    case "badge-check":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3.5 14.2 5l2.7-.2 1 2.5 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-1 2.5-2.7-.2L12 20.5 9.8 19l-2.7.2-1-2.5-2.2-1.6.8-2.6-.8-2.6 2.2-1.6 1-2.5 2.7.2L12 3.5Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
        </svg>
      );

    case "trending-up":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7h6v6" />
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
