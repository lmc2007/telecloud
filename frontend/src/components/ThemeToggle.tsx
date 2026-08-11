import { Sun, Moon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      className="btn-ghost"
    >
      {theme === "dark" ? <Sun className="w-[18px] h-[18px]" strokeWidth={1.6} /> : <Moon className="w-[18px] h-[18px]" strokeWidth={1.6} />}
    </button>
  );
}
