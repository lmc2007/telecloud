import { create } from "zustand";
import { api } from "../lib/api";

export interface FileItem {
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  size_formatted?: string;
  mime_type?: string;
  is_chunks?: boolean;
  child_count?: number;
  created_at: number;
  updated_at?: number;
  path?: string;
  download_url?: string;
}

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

interface FileState {
  files: FileItem[];
  trashFiles: FileItem[];
  currentFolder: string | null;
  breadcrumbs: BreadcrumbItem[];
  isLoading: boolean;
  error: string | null;

  fetchFiles: (parentId?: string | null) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFile: (id: string, name: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  moveFile: (id: string, targetParentId: string | null) => Promise<void>;
  navigateTo: (folderId: string | null, folderName?: string) => void;
  clearError: () => void;
  fetchTrash: () => Promise<void>;
  restoreFile: (id: string) => Promise<void>;
  permanentDelete: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;

  // internal
  _fetching: Map<string, Promise<void>>;
  _cache: Map<string, { data: FileItem[]; ts: number }>;
  _CACHE_TTL: number;
}

export const useFileStore = create<FileState>((set, get) => ({
  files: [],
  trashFiles: [],
  currentFolder: null,
  breadcrumbs: [{ id: null, name: "全部文件" }],
  isLoading: false,
  error: null,

  // In-flight request dedup keyed by cacheKey → Promise
  _fetching: new Map<string, Promise<void>>(),
  // Short-lived cache: cacheKey → { data, ts }
  _cache: new Map<string, { data: FileItem[]; ts: number }>(),
  _CACHE_TTL: 30_000, // 30s

  fetchFiles: async (parentId) => {
    const folderId = parentId !== undefined ? parentId : get().currentFolder;
    const cacheKey = folderId ?? "__root__";

    // Return cached data if fresh
    const cached = get()._cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < get()._CACHE_TTL) {
      set({ files: cached.data, isLoading: false, error: null });
      return;
    }

    // Dedup concurrent requests for the same cacheKey
    const inflight = get()._fetching.get(cacheKey);
    if (inflight) { await inflight; return; }

    set({ isLoading: true, error: null });
    const promise = (async () => {
      try {
        const query = folderId ? `?parent_id=${folderId}` : "";
        const res = await api.get<{ success: boolean; data: FileItem[] }>(
          `/files${query}`
        );
        set({ files: res.data, isLoading: false });
        get()._cache.set(cacheKey, { data: res.data, ts: Date.now() });
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "加载失败",
          isLoading: false,
        });
      } finally {
        get()._fetching.delete(cacheKey);
      }
    })();
    get()._fetching.set(cacheKey, promise);
    await promise;
  },

  createFolder: async (name) => {
    set({ error: null });
    try {
      await api.post("/files/folder", {
        name,
        parent_id: get().currentFolder || undefined,
      });
      get()._cache.clear(); // invalidate cache after mutation
      await get().fetchFiles();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "创建失败" });
      throw err;
    }
  },

  renameFile: async (id, name) => {
    const prev = get().files;
    set({ files: prev.map((f) => (f.id === id ? { ...f, name } : f)) });
    try {
      await api.put(`/files/${id}/rename`, { name });
      get()._cache.clear();
    } catch (err) {
      set({
        files: prev,
        error: err instanceof Error ? err.message : "重命名失败",
      });
    }
  },

  deleteFile: async (id) => {
    const prev = get().files;
    set({ files: prev.filter((f) => f.id !== id) });
    try {
      await api.delete(`/files/${id}`);
      get()._cache.clear();
    } catch (err) {
      set({
        files: prev,
        error: err instanceof Error ? err.message : "删除失败",
      });
    }
  },

  moveFile: async (id, targetParentId) => {
    const prev = get().files;
    set({ files: prev.filter((f) => f.id !== id) });
    try {
      await api.put(`/files/${id}/move`, {
        target_parent_id: targetParentId,
      });
      get()._cache.clear();
    } catch (err) {
      set({
        files: prev,
        error: err instanceof Error ? err.message : "移动失败",
      });
    }
  },

  navigateTo: (folderId, folderName) => {
    const { breadcrumbs } = get();
    if (folderId === null) {
      set({
        breadcrumbs: [{ id: null, name: "全部文件" }],
        currentFolder: null,
      });
    } else {
      const existingIndex = breadcrumbs.findIndex(
        (b) => b.id === folderId
      );
      if (existingIndex >= 0) {
        set({
          breadcrumbs: breadcrumbs.slice(0, existingIndex + 1),
          currentFolder: folderId,
        });
      } else {
        set({
          breadcrumbs: [
            ...breadcrumbs,
            { id: folderId, name: folderName || "文件夹" },
          ],
          currentFolder: folderId,
        });
      }
    }
    get().fetchFiles(folderId);
  },

  clearError: () => set({ error: null }),

  fetchTrash: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<{ success: boolean; data: FileItem[] }>(
        "/files/trash"
      );
      set({ trashFiles: res.data, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "加载失败",
        isLoading: false,
      });
    }
  },

  restoreFile: async (id) => {
    const prev = get().trashFiles;
    set({ trashFiles: prev.filter((f) => f.id !== id) });
    try {
      await api.post(`/files/trash/${id}/restore`);
    } catch (err) {
      set({
        trashFiles: prev,
        error: err instanceof Error ? err.message : "恢复失败",
      });
    }
  },

  permanentDelete: async (id) => {
    const prev = get().trashFiles;
    set({ trashFiles: prev.filter((f) => f.id !== id) });
    try {
      await api.delete(`/files/trash/${id}`);
    } catch (err) {
      set({
        trashFiles: prev,
        error: err instanceof Error ? err.message : "删除失败",
      });
    }
  },

  emptyTrash: async () => {
    const prev = get().trashFiles;
    set({ trashFiles: [] });
    try {
      await api.delete("/files/trash");
    } catch (err) {
      set({
        trashFiles: prev,
        error: err instanceof Error ? err.message : "清空失败",
      });
    }
  },
}));
