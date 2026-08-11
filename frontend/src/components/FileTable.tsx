import { FileIcon } from "./FileIcon";
import { fmtSize, fmtDate, kindLabel, isPreviewable } from "../lib/utils";
import type { FileItem } from "../stores/fileStore";
import type { SortKey, SortDir } from "../types/ui";

interface FileTableProps {
  files: FileItem[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onNavigate: (id: string, name: string) => void;
  onContextMenu: (item: FileItem, x: number, y: number) => void;
  onPreview?: (item: FileItem) => void;
  selected: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}

export function FileTable({ files, sortKey, sortDir, onSort, onNavigate, onContextMenu, onPreview, selected, onSelect, onSelectAll }: FileTableProps) {
  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: "名称" },
    { key: "size", label: "大小" },
    { key: "type", label: "类型" },
    { key: "date", label: "修改时间" },
  ];

  const allSelected = files.length > 0 && files.every(f => selected.has(f.id));

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="w-[40px] px-3">
            <input type="checkbox" checked={allSelected} onChange={e => onSelectAll(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-[#0071E3]" />
          </th>
          {columns.map(c => (
            <th key={c.key} onClick={() => onSort(c.key)}>
              <span className="inline-flex items-center gap-1">
                {c.label}
                {sortKey === c.key && (
                  <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </span>
            </th>
          ))}
          <th className="w-[40px]" />
        </tr>
      </thead>
      <tbody>
        {files.map(item => (
          <tr key={item.id}
            className={`cursor-pointer ${selected.has(item.id) ? "selected" : ""}`}
            onClick={() => item.type === "folder" ? onNavigate(item.id, item.name) : undefined}
            onDoubleClick={() => { if (item.type === "folder") return; if (isPreviewable(item) && onPreview) { onPreview(item); } else { onContextMenu(item, 0, 0); } }}
            onContextMenu={e => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); }}>
            <td className="px-3" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={selected.has(item.id)} onChange={e => onSelect(item.id, e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[#0071E3]" />
            </td>
            <td>
              <div className="flex items-center gap-2.5 min-w-0">
                <FileIcon item={item} />
                <span className="truncate text-[var(--text-primary)]">{item.name}</span>
              </div>
            </td>
            <td className="text-[var(--text-secondary)]">{item.type === "folder" ? "—" : fmtSize(item.size)}</td>
            <td className="text-[var(--text-secondary)]">{kindLabel(item)}</td>
            <td className="text-[var(--text-secondary)]">{fmtDate(item.updated_at || item.created_at)}</td>
            <td className="pr-3">
              <button onClick={e => { e.stopPropagation(); onContextMenu(item, e.clientX, e.clientY); }}
                className="btn-ghost opacity-0 group-hover:opacity-100 w-7 h-7">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12" cy="8" r="1.5"/></svg>
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
