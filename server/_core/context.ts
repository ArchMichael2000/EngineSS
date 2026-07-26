import type { User } from "../../drizzle/schema";

export interface TrpcContext {
  user: User | null;
  req: {
    protocol?: string;
    headers?: Record<string, string | string[] | undefined>;
  };
  res: {
    clearCookie: (name: string, options?: Record<string, unknown>) => void;
  };
}
