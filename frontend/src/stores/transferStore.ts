import { create } from "zustand";

export type TransferType = "upload" | "download";
export type TransferStatus =
  | "pending"
  | "transferring"
  | "assembling"
  | "done"
  | "error"
  | "cancelled";

export interface TransferItem {
  id: string;
  type: TransferType;
  fileName: string;
  fileSize: number;
  progress: number;
  status: TransferStatus;
  speed: number;
  error?: string;
  uploadedBytes?: number;
  downloadedBytes?: number; // 下载：已下载字节数（用于进度显示 "已下载 X / 总 Y"）
  chunksTotal?: number;
  chunksDone?: number;
  abortController?: AbortController;
}

interface TransferState {
  transfers: TransferItem[];
  addTransfer: (item: TransferItem) => void;
  updateTransfer: (
    id: string,
    updates: Partial<TransferItem>
  ) => void;
  cancelTransfer: (id: string) => void;
  removeTransfer: (id: string) => void;
  clearDone: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: [],

  addTransfer: (item) =>
    set((state) => ({
      transfers: [...state.transfers, item],
    })),

  updateTransfer: (id, updates) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

  cancelTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.map((t) => {
        if (
          t.id === id &&
          (t.status === "transferring" ||
            t.status === "pending")
        ) {
          t.abortController?.abort();
          return {
            ...t,
            status: "cancelled" as TransferStatus,
            error: "已取消",
          };
        }
        return t;
      }),
    })),

  removeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id),
    })),

  clearDone: () =>
    set((state) => ({
      transfers: state.transfers.filter(
        (t) =>
          t.status !== "done" && t.status !== "cancelled"
      ),
    })),
}));
