"use client";

import React from "react";
import { Icon } from "../Icons";

export default function MetaRow({
  icon,
  text,
  className = "",
}: {
  icon: "briefcase" | "cap" | "pin" | "cash" | "cash-stack";
  text: string;
  className?: string;
}) {
  return (
    <div className={["flex items-center gap-2 text-sm", className].join(" ")}>
      <span className="text-white/70">
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <span className="text-white/90 leading-snug">{text}</span>
    </div>
  );
}
