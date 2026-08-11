/* Minecraft Java 版风格的加载进度条 */
const MC_GREEN = "#5B8731";
const MC_GREEN_LIGHT = "#7CAC3A";
const MC_STONE = "#8B8B8B";
const MC_STONE_LIGHT = "#AAAAAA";
const MC_STONE_DARK = "#6B6B6B";
const MC_DIRT = "#5A4A3A";
const MC_BORDER = "#373737";

interface MCProgressBarProps {
  progress: number; // 0-100
  label?: string;
  sublabel?: string;
  height?: number;
}

export function MCProgressBar({ progress, label, sublabel, height = 12 }: MCProgressBarProps) {
  const pct = Math.max(0.5, Math.min(100, progress));
  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className="flex justify-between mb-0.5 px-0.5">
          <span className="text-[10px] text-[#9CA3AF] tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>
            {label || ""}
          </span>
          <span className="text-[10px] text-[#9CA3AF] tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>
            {sublabel || `${Math.round(pct)}%`}
          </span>
        </div>
      )}
      {/* Outer stone frame — 3D bevel: lighter top/left, darker bottom/right */}
      <div className="relative rounded-sm overflow-hidden"
        style={{
          height,
          background: MC_STONE,
          border: `2px solid ${MC_BORDER}`,
          boxShadow: `
            inset 1px 1px 0 ${MC_STONE_LIGHT},
            inset -1px -1px 0 ${MC_STONE_DARK},
            0 1px 0 rgba(0,0,0,0.3)
          `,
          imageRendering: "pixelated",
        }}>
        {/* Dirt-textured background */}
        <div className="absolute inset-0" style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.05) 2px,
            rgba(0,0,0,0.05) 4px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.04) 2px,
            rgba(0,0,0,0.04) 4px
          ),
          ${MC_DIRT}`,
        }} />

        {/* Progress fill */}
        <div className="absolute inset-y-0 left-0 rounded-sm transition-all duration-200"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(180deg, ${MC_GREEN_LIGHT} 0%, ${MC_GREEN} 50%, #4A7A28 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.2)`,
          }}>
          {/* Pulsing highlight scan line */}
          <div className="absolute inset-0" style={{
            background: `linear-gradient(90deg, rgba(255,255,255,0.12) 0%, transparent 50%, rgba(255,255,255,0.08) 100%)`,
            animation: "mcScan 2s ease-in-out infinite",
          }} />
          {/* Pixel gap pattern */}
          <div className="absolute inset-0" style={{
            background: `repeating-linear-gradient(
              90deg,
              transparent,
              transparent 2px,
              rgba(0,0,0,0.06) 2px,
              rgba(0,0,0,0.06) 4px
            )`,
          }} />
        </div>
      </div>
      <style>{`
        @keyframes mcScan {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
