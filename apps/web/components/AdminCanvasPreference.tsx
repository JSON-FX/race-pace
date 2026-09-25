"use client";

import { useEffect, useState } from "react";

type Canvas = "white" | "white-gray" | "fieldnotes";
const KEY = "racepace-admin-canvas";
const OPTIONS: { value: Canvas; label: string; color: string }[] = [
  { value: "white", label: "White", color: "#ffffff" },
  { value: "white-gray", label: "White-gray", color: "#f5f6f5" },
  { value: "fieldnotes", label: "Fieldnotes", color: "#f5f5ed" },
];

function storedCanvas(): Canvas {
  try {
    const value = localStorage.getItem(KEY);
    return OPTIONS.some((option) => option.value === value) ? value as Canvas : "white";
  } catch {
    return "white";
  }
}

function applyCanvas(value: Canvas) {
  document.documentElement.dataset.adminCanvas = value;
}

export function AdminCanvasController() {
  useEffect(() => {
    applyCanvas(storedCanvas());
    const sync = () => applyCanvas(storedCanvas());
    window.addEventListener("storage", sync);
    window.addEventListener("racepace-canvas-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("racepace-canvas-change", sync);
    };
  }, []);
  return null;
}

export function AdminCanvasPreference({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState<Canvas>("white");
  useEffect(() => { setValue(storedCanvas()); }, []);

  function choose(next: Canvas) {
    setValue(next);
    applyCanvas(next);
    try { localStorage.setItem(KEY, next); } catch { /* Visual choice still works for this page. */ }
    window.dispatchEvent(new Event("racepace-canvas-change"));
  }

  return (
    <section className={`rounded-[18px] border bg-card p-4 shadow-card ${compact ? "fieldnotes-canvas-preference--sidebar" : "mb-[18px]"}`} aria-labelledby="canvas-heading">
      <div className="mb-3">
        <h2 id="canvas-heading" className="text-[15px] font-semibold">Workspace background</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Choose the canvas for admin pages. Saved in this browser.</p>
      </div>
      <div className={`fieldnotes-canvas-options ${compact ? "fieldnotes-canvas-options--sidebar" : ""}`} role="group" aria-label="Workspace background">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => choose(option.value)}
            className="fieldnotes-canvas-option"
          >
            <span className="fieldnotes-canvas-option__swatch" style={{ backgroundColor: option.color }} aria-hidden="true" />
            <span className="fieldnotes-canvas-option__label">{option.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
