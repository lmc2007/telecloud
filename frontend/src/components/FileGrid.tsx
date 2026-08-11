import { LargeIcon } from "./FileIcon";
import { fmtSize, isPreviewable } from "../lib/utils";
import type { FileItem } from "../stores/fileStore";

interface FileGridProps {
  files: FileItem[];
  onNavigate: (id: string, name: string) => void;
  onContextMenu: (item: FileItem, x: number, y: number) => void;
  onPreview?: (item: FileItem) => void;
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  onSelectAll?: (checked: boolean) => void;
}

export function FileGrid({ files, onNavigate, onContextMenu, onPreview, selected, onSelect, onSelectAll }: FileGridProps) {
  const allSelected = files.length > 0 && files.every(f => selected?.has(f.id));

  return (
    <div className="p-4">
      {onSelectAll && (
        <div className="flex items-center gap-2.5 mb-2 px-1">
          <input type="checkbox" checked={allSelected} onChange={e => onSelectAll(e.target.checked)}
            className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer" />
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {selected && selected.size > 0 ? `已选 ${selected.size} 项` : "全选"}
          </span>
        </div>
      )}
      {/* iCloud-style dense grid: no cards, items float on background */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-1">
        {files.map(item => {
          const isSel = selected?.has(item.id);
          return (
            <div key={item.id}
              className={`group relative rounded-xl p-3 cursor-pointer transition-all duration-150
                ${isSel ? "" : "hover:bg-[var(--bg-hover)]"}`}
              style={{ background: isSel ? 'var(--accent-light)' : 'transparent' }}
              onClick={() => item.type === "folder" ? onNavigate(item.id, item.name) : undefined}
              onDoubleClick={() => { if (item.type === "folder") return; if (isPreviewable(item) && onPreview) { onPreview(item); } else { onContextMenu(item, 0, 0); } }}
              onContextMenu={e => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); }}>
              {onSelect && (
                <div className="absolute top-1.5 left-1.5 z-10" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={!!isSel} onChange={e => onSelect(item.id, e.target.checked)}
                    className={`w-4 h-4 rounded accent-[var(--accent)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity ${isSel ? "!opacity-100" : ""}`} />
                </div>
              )}
              <div className="flex justify-center py-2.5 transition-transform duration-150 group-hover:scale-[1.05]">
                <LargeIcon item={item} />
              </div>
              <p title={item.name} className={`text-[12px] truncate text-center mt-1.5 transition-colors ${isSel ? "font-medium" : ""}`}
                style={{ color: isSel ? 'var(--accent-text)' : 'var(--text)' }}>{item.name}</p>
              <p className="text-[11px] text-center mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {item.type === "folder" ? "文件夹" : fmtSize(item.size)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}