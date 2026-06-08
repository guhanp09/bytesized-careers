"use client";

import { useState } from "react";

function TestBulletEditor() {
  const [lines, setLines] = useState<string[]>([""]);

  const updateLine = (idx: number, value: string) => {
    const next = [...lines];
    next[idx] = value;
    setLines(next);
  };

  const insertLine = (idx: number) => {
    const next = [...lines];
    next.splice(idx + 1, 0, "");
    setLines(next);
  };

  const mergeLine = (idx: number) => {
    if (idx === 0) return;
    const next = [...lines];
    const prev = next[idx - 1];
    next[idx - 1] = `${prev}${next[idx] ? " " : ""}${next[idx]}`;
    next.splice(idx, 1);
    setLines(next);
  };

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5">
      {lines.map((line, idx) => (
        <div key={`test-bullet-${idx}`} className="flex items-start gap-3">
          <span className="mt-[6px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-white/80" />
          <textarea
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-white outline-none"
            rows={1}
            value={line}
            placeholder={idx === 0 ? "Type responsibilities..." : undefined}
            onChange={(event) => updateLine(idx, event.target.value)}
            onKeyDown={(event) => {
              const start = event.currentTarget.selectionStart ?? 0;
              const end = event.currentTarget.selectionEnd ?? 0;
              if (event.key === "Enter") {
                event.preventDefault();
                insertLine(idx);
              }
              if (event.key === "Backspace" && start === 0 && end === 0) {
                event.preventDefault();
                mergeLine(idx);
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function SmartTypingTestClient() {
  const [single, setSingle] = useState("");
  const [para, setPara] = useState("");

  return (
    <div className="min-h-screen bg-[#0b0b10] px-8 py-10 text-white">
      <div className="max-w-2xl space-y-8">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
            Single-line Input
          </div>
          <input
            className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-white/6 px-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/7"
            value={single}
            onChange={(event) => setSingle(event.target.value)}
            placeholder="Type a sentence..."
          />
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
            Paragraph
          </div>
          <textarea
            className="mt-3 min-h-[120px] w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/7"
            value={para}
            onChange={(event) => setPara(event.target.value)}
            placeholder="Write a short paragraph..."
          />
        </div>

        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
            Bullet Editor
          </div>
          <div className="mt-3">
            <TestBulletEditor />
          </div>
        </div>
      </div>
    </div>
  );
}
