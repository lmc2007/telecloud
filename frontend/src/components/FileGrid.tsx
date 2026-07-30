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
      {/* Select-all bar */}
      {onSelectAll && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <input type="checkbox" checked={allSelected} onChange={e => onSelectAll(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-[var(--border-default)] text-[var(--brand-blue)] cursor-pointer" />
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {selected && selected.size > 0 ? `已选 ${selected.size} 项` : "全选"}
          </span>
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {files.map(item => {
          const isSel = selected?.has(item.id);
          return (
            <div key={item.id}
              className={`card p-3 cursor-pointer group relative ${isSel ? "border-[var(--brand-blue)] bg-[var(--brand-blue-light)]" : "card-hover"}`}
              onClick={() => item.type === "folder" ? onNavigate(item.id, item.name) : undefined}
              onDoubleClick={() => { if (item.type === "folder") return; if (isPreviewable(item) && onPreview) { onPreview(item); } else { onContextMenu(item, 0, 0); } }}
              onContextMenu={e => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); }}>
              {/* Checkbox */}
              {onSelect && (
                <div className="absolute top-1.5 left-1.5 z-10" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={!!isSel} onChange={e => onSelect(item.id, e.target.checked)}
                    className={`w-3.5 h-3.5 rounded border-[var(--border-default)] text-[var(--brand-blue)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity ${isSel ? "!opacity-100" : ""}`} />
                </div>
              )}
              <div className="flex justify-center py-2">
                <LargeIcon item={item} />
              </div>
              <p className="text-[12px] font-medium text-[var(--text-primary)] truncate text-center mt-1.5">{item.name}</p>
              <p className="text-[11px] text-[var(--text-tertiary)] text-center mt-0.5">
                {item.type === "folder" ? "文件夹" : fmtSize(item.size)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
