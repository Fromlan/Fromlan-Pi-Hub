import { useStore } from "../store";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
      aria-label="切换主题"
    >
      <Icon size={14} />
      <span>{theme === "dark" ? "浅色" : "深色"}</span>
    </button>
  );
}