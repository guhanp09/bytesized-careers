"use client";

import { useId, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Icon } from "../Icons";

type ToolPickerProps = {
  value: string[];
  onChange: (nextTools: string[]) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  inputId?: string;
};

const TOOL_CATEGORIES = [
  {
    name: "Popular",
    tools: [
      "Premiere Pro",
      "After Effects",
      "DaVinci Resolve",
      "Final Cut Pro",
      "CapCut",
      "Photoshop",
      "Figma",
      "Canva",
      "YouTube Studio",
      "Notion",
    ],
  },
  {
    name: "Video editing",
    tools: [
      "Premiere Pro",
      "DaVinci Resolve",
      "Final Cut Pro",
      "CapCut",
      "iMovie",
      "Filmora",
      "Vegas Pro",
      "Avid Media Composer",
      "VN",
      "KineMaster",
      "InShot",
    ],
  },
  {
    name: "Short-form",
    tools: [
      "CapCut",
      "VN",
      "InShot",
      "Instagram Edits",
      "TikTok Editor",
      "YouTube Create",
      "Captions",
      "Submagic",
      "OpusClip",
      "Descript",
    ],
  },
  {
    name: "Motion & VFX",
    tools: [
      "After Effects",
      "Blender",
      "Cinema 4D",
      "Fusion",
      "Apple Motion",
      "Cavalry",
      "Rive",
      "LottieFiles",
      "Runway",
      "Rotato",
    ],
  },
  {
    name: "Design",
    tools: [
      "Photoshop",
      "Illustrator",
      "Figma",
      "Canva",
      "Photopea",
      "Lightroom",
      "Midjourney",
      "DALL-E",
      "Ideogram",
      "Leonardo AI",
      "Freepik",
      "Envato Elements",
    ],
  },
  {
    name: "Audio",
    tools: [
      "Audition",
      "Audacity",
      "Logic Pro",
      "GarageBand",
      "Pro Tools",
      "Descript",
      "Riverside",
      "SquadCast",
      "Zencastr",
      "Auphonic",
      "Adobe Podcast",
      "ElevenLabs",
    ],
  },
  {
    name: "Writing",
    tools: [
      "Google Docs",
      "Notion",
      "ChatGPT",
      "Claude",
      "Perplexity",
      "Grammarly",
      "Hemingway",
      "Jasper",
      "Scrivener",
      "Airtable",
    ],
  },
  {
    name: "YouTube & analytics",
    tools: [
      "YouTube Studio",
      "TubeBuddy",
      "vidIQ",
      "ViewStats",
      "Google Trends",
      "Google Analytics",
      "Search Console",
      "Social Blade",
      "Morningfame",
      "Thumbnail Test",
    ],
  },
  {
    name: "Social & scheduling",
    tools: [
      "Meta Business Suite",
      "TikTok Studio",
      "Buffer",
      "Hootsuite",
      "Later",
      "Metricool",
      "Sprout Social",
      "Planoly",
      "Publer",
    ],
  },
  {
    name: "Collaboration",
    tools: [
      "Notion",
      "Trello",
      "Asana",
      "ClickUp",
      "Slack",
      "Discord",
      "Google Drive",
      "Dropbox",
      "Frame.io",
      "Airtable",
      "Miro",
      "FigJam",
    ],
  },
  {
    name: "Live & recording",
    tools: [
      "OBS",
      "Streamlabs",
      "Ecamm Live",
      "Restream",
      "Riverside",
      "Zoom",
      "Google Meet",
      "StreamYard",
      "Twitch Studio",
    ],
  },
  {
    name: "Creator ops",
    tools: [
      "WordPress",
      "Webflow",
      "Framer",
      "Shopify",
      "Gumroad",
      "ConvertKit",
      "Beehiiv",
      "Mailchimp",
      "Zapier",
      "Make",
    ],
  },
  {
    name: "AI tools",
    tools: [
      "ChatGPT",
      "Claude",
      "Perplexity",
      "Midjourney",
      "DALL-E",
      "Runway",
      "ElevenLabs",
      "Suno",
      "Pika",
      "HeyGen",
      "Captions",
      "OpusClip",
    ],
  },
] as const;

const normalizeToolKey = (tool: string) => tool.trim().toLowerCase();

const cleanToolList = (tools: string[]) => {
  const seen = new Set<string>();
  return tools
    .map((tool) => tool.trim())
    .filter(Boolean)
    .filter((tool) => {
      const key = normalizeToolKey(tool);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const allTools = cleanToolList(TOOL_CATEGORIES.flatMap((category) => [...category.tools]));

export function parseToolString(value?: string | null) {
  if (!value) return [];
  return cleanToolList(value.split(/[,;\n]/));
}

export function formatToolString(tools: string[]) {
  return cleanToolList(tools).join(", ");
}

export default function ToolPicker({
  value,
  onChange,
  label = "Tools",
  placeholder = "Premiere Pro, CapCut, Figma, YouTube Studio...",
  className = "space-y-3 md:col-span-2",
  inputId,
}: ToolPickerProps) {
  const fallbackId = useId();
  const resolvedInputId = inputId || fallbackId;
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<(typeof TOOL_CATEGORIES)[number]["name"]>("Popular");
  const selectedKeys = useMemo(() => new Set(value.map(normalizeToolKey)), [value]);
  const trimmedQuery = query.trim();

  const suggestions = useMemo(() => {
    if (trimmedQuery) {
      const needle = trimmedQuery.toLowerCase();
      return allTools.filter((tool) => tool.toLowerCase().includes(needle) && !selectedKeys.has(normalizeToolKey(tool))).slice(0, 10);
    }
    const category = TOOL_CATEGORIES.find((item) => item.name === activeCategory) || TOOL_CATEGORIES[0];
    return category.tools.filter((tool) => !selectedKeys.has(normalizeToolKey(tool))).slice(0, 10);
  }, [activeCategory, selectedKeys, trimmedQuery]);

  const addTools = (nextTools: string[]) => {
    const merged = cleanToolList([...value, ...nextTools]);
    onChange(merged);
  };

  const addFromInput = () => {
    const entries = query.split(",").map((item) => item.trim()).filter(Boolean);
    if (!entries.length) return;
    const canonicalEntries = entries.map((entry) => {
      const match = allTools.find((tool) => normalizeToolKey(tool) === normalizeToolKey(entry));
      return match || entry;
    });
    addTools(canonicalEntries);
    setQuery("");
  };

  const removeTool = (tool: string) => {
    const removeKey = normalizeToolKey(tool);
    onChange(value.filter((item) => normalizeToolKey(item) !== removeKey));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFromInput();
      return;
    }
    if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
      return;
    }
    if (event.key === "Escape") {
      setQuery("");
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes(",")) return;
    event.preventDefault();
    addTools(text.split(","));
    setQuery("");
  };

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={resolvedInputId} className="inline-flex items-center gap-2 text-xs font-semibold text-white/55">
          <Icon name="sliders-horizontal" className="h-4 w-4 text-white/55" />
          {label}
        </label>
      ) : null}

      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input
          id={resolvedInputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-white/35 focus:border-white/28 focus:outline-none focus:ring-2 focus:ring-white/10"
          placeholder={placeholder}
        />
      </div>

      {value.length ? (
        <div className="flex flex-wrap gap-2">
          {value.map((tool) => (
            <span
              key={`selected-tool-${tool}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/18 bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white/86"
            >
              {tool}
              <button
                type="button"
                onClick={() => removeTool(tool)}
                aria-label={`Remove ${tool}`}
                className="cursor-pointer rounded-full text-white/45 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!trimmedQuery ? (
        <div className="overflow-x-auto border-b border-white/[0.08]">
          <div className="flex min-w-max items-end gap-6">
            {TOOL_CATEGORIES.map((category) => (
              <button
                key={`tool-category-${category.name}`}
                type="button"
                onClick={() => setActiveCategory(category.name)}
                className={[
                  "relative h-9 shrink-0 cursor-pointer px-0.5 text-xs font-semibold whitespace-nowrap transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141519]",
                  activeCategory === category.name
                    ? "text-white after:bg-white"
                    : "text-white/42 after:bg-transparent hover:text-white/72",
                ].join(" ")}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {suggestions.map((tool) => (
          <button
            key={`tool-suggestion-${tool}`}
            type="button"
            onClick={() => addTools([tool])}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/22 hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
          >
            <Icon name="plus" className="h-3.5 w-3.5 text-white/40" />
            {tool}
          </button>
        ))}
        {trimmedQuery && !selectedKeys.has(normalizeToolKey(trimmedQuery)) ? (
          <button
            type="button"
            onClick={addFromInput}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/16 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/82 transition-colors hover:border-white/26 hover:bg-white/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
          >
            <Icon name="plus" className="h-3.5 w-3.5 text-white/45" />
            Add &quot;{trimmedQuery}&quot;
          </button>
        ) : null}
      </div>
    </div>
  );
}
