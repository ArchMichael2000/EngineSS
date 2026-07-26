import { useEffect, useMemo, useState } from "react";
import type { EngineConfiguration } from "../../../shared/engineTypes";

type EngineRecord = {
  id: number;
  userId: number;
  name: string;
  description?: string | null;
  config: EngineConfiguration;
  isPublic: boolean;
  upvotes: number;
  userName: string;
  createdAt: string;
  updatedAt: string;
};

type MutationOptions<TData = unknown> = {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
};

type QueryOptions = {
  enabled?: boolean;
  refetchInterval?: number;
};

const STORAGE_KEY = "ess.local.engines";
const UPVOTE_KEY = "ess.local.upvotes";

function now() {
  return new Date().toISOString();
}

function readEngines(): EngineRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as EngineRecord[];
  } catch {
    return [];
  }
}

function writeEngines(records: EngineRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new CustomEvent("ess:local-data"));
}

function readUpvotes(): number[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(UPVOTE_KEY) || "[]") as number[];
  } catch {
    return [];
  }
}

function writeUpvotes(ids: number[]) {
  localStorage.setItem(UPVOTE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent("ess:local-data"));
}

function useLocalQuery<T>(factory: () => T, options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener("ess:local-data", handler);
    return () => window.removeEventListener("ess:local-data", handler);
  }, []);

  const data = useMemo(() => (enabled ? factory() : undefined), [enabled, version]);
  return { data, isLoading: false, refetch: () => setVersion((v) => v + 1) };
}

function useLocalMutation<TInput, TData>(handler: (input: TInput) => TData, options?: MutationOptions<TData>) {
  const [isPending, setPending] = useState(false);

  return {
    isPending,
    mutate(input: TInput) {
      setPending(true);
      try {
        const data = handler(input);
        options?.onSuccess?.(data);
      } catch (error) {
        options?.onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setPending(false);
      }
    },
  };
}

function nextId(records: EngineRecord[]) {
  return records.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

export const trpc = {
  useUtils() {
    const invalidate = () => window.dispatchEvent(new CustomEvent("ess:local-data"));
    return {
      engine: { myConfigs: { invalidate } },
      community: { list: { invalidate }, myUpvotes: { invalidate } },
    };
  },
  engine: {
    getById: {
      useQuery(input: { id: number }, options?: QueryOptions) {
        return useLocalQuery(() => readEngines().find((item) => item.id === input.id) ?? null, options);
      },
    },
    save: {
      useMutation(options?: MutationOptions<{ id: number; success: boolean }>) {
        return useLocalMutation((input: { name: string; config: EngineConfiguration; description?: string }) => {
          const records = readEngines();
          const createdAt = now();
          const record: EngineRecord = {
            id: nextId(records),
            userId: 1,
            name: input.name,
            description: input.description ?? null,
            config: input.config,
            isPublic: false,
            upvotes: 0,
            userName: "Local Tester",
            createdAt,
            updatedAt: createdAt,
          };
          writeEngines([record, ...records]);
          return { id: record.id, success: true };
        }, options);
      },
    },
    myConfigs: {
      useQuery(_input?: unknown, options?: QueryOptions) {
        return useLocalQuery(() => readEngines().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), options);
      },
    },
    delete: {
      useMutation(options?: MutationOptions<{ success: boolean }>) {
        return useLocalMutation((input: { id: number }) => {
          writeEngines(readEngines().filter((item) => item.id !== input.id));
          return { success: true };
        }, options);
      },
    },
    duplicate: {
      useMutation(options?: MutationOptions<{ id: number; success: boolean }>) {
        return useLocalMutation((input: { id: number; name?: string }) => {
          const records = readEngines();
          const original = records.find((item) => item.id === input.id);
          if (!original) throw new Error("Config not found");
          const createdAt = now();
          const copy = { ...original, id: nextId(records), name: input.name ?? `${original.name} (Copy)`, isPublic: false, createdAt, updatedAt: createdAt };
          writeEngines([copy, ...records]);
          return { id: copy.id, success: true };
        }, options);
      },
    },
    rename: {
      useMutation(options?: MutationOptions<{ success: boolean }>) {
        return useLocalMutation((input: { id: number; name: string }) => {
          writeEngines(readEngines().map((item) => item.id === input.id ? { ...item, name: input.name, updatedAt: now() } : item));
          return { success: true };
        }, options);
      },
    },
  },
  community: {
    list: {
      useQuery(_input?: { limit?: number; offset?: number }, options?: QueryOptions) {
        return useLocalQuery(() => readEngines().filter((item) => item.isPublic), options);
      },
    },
    myUpvotes: {
      useQuery(_input?: unknown, options?: QueryOptions) {
        return useLocalQuery(() => readUpvotes(), options);
      },
    },
    upvote: {
      useMutation(options?: MutationOptions<{ added: boolean }>) {
        return useLocalMutation((input: { configId: number }) => {
          const ids = readUpvotes();
          const added = !ids.includes(input.configId);
          writeUpvotes(added ? [...ids, input.configId] : ids.filter((id) => id !== input.configId));
          writeEngines(readEngines().map((item) => item.id === input.configId ? { ...item, upvotes: Math.max(0, item.upvotes + (added ? 1 : -1)) } : item));
          return { added };
        }, options);
      },
    },
    clone: {
      useMutation(options?: MutationOptions<{ id: number; success: boolean }>) {
        return useLocalMutation((input: { configId: number }) => {
          const records = readEngines();
          const original = records.find((item) => item.id === input.configId);
          if (!original) throw new Error("Config not found");
          const createdAt = now();
          const copy = { ...original, id: nextId(records), name: `${original.name} (Clone)`, isPublic: false, createdAt, updatedAt: createdAt };
          writeEngines([copy, ...records]);
          return { id: copy.id, success: true };
        }, options);
      },
    },
    publish: {
      useMutation(options?: MutationOptions<{ success: boolean }>) {
        return useLocalMutation((input: { configId: number }) => {
          writeEngines(readEngines().map((item) => item.id === input.configId ? { ...item, isPublic: true, updatedAt: now() } : item));
          return { success: true };
        }, options);
      },
    },
  },
  export: {
    create: {
      useMutation(options?: MutationOptions<{ jobId: number }>) {
        return useLocalMutation(() => ({ jobId: Date.now() }), options);
      },
    },
    status: {
      useQuery(_input: { jobId: number }, options?: QueryOptions) {
        return useLocalQuery(() => ({ status: "completed", fileUrl: null as string | null, errorMessage: null as string | null }), options);
      },
    },
  },
};

