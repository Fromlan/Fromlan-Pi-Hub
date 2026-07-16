import { useStore } from "../store";
import { Search } from "lucide-react";

export function SearchInput() {
  const value = useStore((s) => s.sidebarSearch);
  const setSearch = useStore((s) => s.setSidebarSearch);
  return (
    <div className="search-input">
      <Search size={12} className="search-input-icon" />
      <input
        type="text"
        value={value}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索会话…"
        spellCheck={false}
      />
      {value && (
        <button className="search-input-clear" onClick={() => setSearch("")} aria-label="清空搜索">
          ×
        </button>
      )}
    </div>
  );
}