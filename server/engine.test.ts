import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

function createUnauthContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("engine routes", () => {
  describe("engine.save", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.engine.save({
          name: "Test Engine",
          config: { quick: { layout: "v", cylinderCount: 8 } },
        })
      ).rejects.toThrow();
    });

    it("validates name is not empty", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.engine.save({
          name: "",
          config: { quick: { layout: "v", cylinderCount: 8 } },
        })
      ).rejects.toThrow();
    });
  });

  describe("engine.delete", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.engine.delete({ id: 1 })
      ).rejects.toThrow();
    });
  });

  describe("engine.myConfigs", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.engine.myConfigs()
      ).rejects.toThrow();
    });
  });
});

describe("community routes", () => {
  describe("community.list", () => {
    it("is accessible without authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should not throw - public endpoint
      // May throw DB error in test env but should not throw auth error
      try {
        await caller.community.list({ limit: 10, offset: 0 });
      } catch (e: any) {
        // DB connection error is acceptable in test, auth error is not
        expect(e.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("community.upvote", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.community.upvote({ configId: 1 })
      ).rejects.toThrow();
    });
  });

  describe("community.clone", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.community.clone({ configId: 1 })
      ).rejects.toThrow();
    });
  });

  describe("community.publish", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.community.publish({ configId: 1 })
      ).rejects.toThrow();
    });
  });
});

describe("export routes", () => {
  describe("export.create", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.export.create({ configId: null, format: "wav", duration: 10 })
      ).rejects.toThrow();
    });

    it("validates duration range", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.export.create({ configId: null, format: "wav", duration: 200 })
      ).rejects.toThrow();
    });

    it("validates format enum", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.export.create({ configId: null, format: "ogg" as any, duration: 10 })
      ).rejects.toThrow();
    });
  });

  describe("export.myJobs", () => {
    it("requires authentication", async () => {
      const { ctx } = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.export.myJobs()
      ).rejects.toThrow();
    });
  });
});
