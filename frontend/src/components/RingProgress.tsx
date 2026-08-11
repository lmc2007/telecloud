interface RingProgressProps {
  progress: number; // 0-100
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  status?: "active" | "done" | "error";
}

/* Reusable Apple-style ring progress indicator */
export function RingProgress({ progress, size = 28, stroke = 3, color, trackColor, status = "active" }: RingProgressProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, progress));
  const offset = c - (pct / 100) * c;

  const fillColor = status === "done" ? "var(--green)" : status === "error" ? "var(--red)" : (color || "var(--accent)");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0" style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor || "rgba(128,128,128,0.2)"} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={fillColor} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease" }}
      />
      {/* Center icon for done/error */}
      {status === "done" && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.5} fill="var(--green)" style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>✓</text>
      )}
      {status === "error" && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.45} fill="var(--red)" style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>✕</text>
      )}
    </svg>
  );
}
