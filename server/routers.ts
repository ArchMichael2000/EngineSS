import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  saveEngineConfig,
  updateEngineConfig,
  deleteEngineConfig,
  getUserConfigs,
  getPublicConfigs,
  getConfigById,
  toggleUpvote,
  getUserUpvotes,
  createExportJob,
  updateExportJob,
  getUserExportJobs,
  getExportJobById,
  duplicateConfig,
} from "./db";
import { renderAndUpload } from "./audioRenderer";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  engine: router({
    // Save a new engine configuration
    save: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        config: z.any(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await saveEngineConfig(ctx.user.id, input.name, input.config, input.description);
        return { id: result.id, success: true };
      }),

    // Update an existing configuration
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        config: z.any().optional(),
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        await updateEngineConfig(id, ctx.user.id, updates);
        return { success: true };
      }),

    // Delete a configuration
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteEngineConfig(input.id, ctx.user.id);
        return { success: true };
      }),

    // Get user's saved configurations
    myConfigs: protectedProcedure.query(async ({ ctx }) => {
      return getUserConfigs(ctx.user.id);
    }),

    // Get a single config by ID
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const config = await getConfigById(input.id);
        if (!config) return null;
        // Only return if public or owned by the requesting user
        if (!config.isPublic && (!ctx.user || config.userId !== ctx.user.id)) {
          return null;
        }
        return config;
      }),

    // Duplicate a configuration (only public or own configs)
    duplicate: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const original = await getConfigById(input.id);
        if (!original) throw new Error('Config not found');
        // Only allow duplicating public configs or own configs
        if (!original.isPublic && original.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        const newName = input.name || `${original.name} (Copy)`;
        const result = await duplicateConfig(ctx.user.id, input.id, newName);
        return { id: result.id, success: true };
      }),

    // Rename a configuration
    rename: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255),
      }))
      .mutation(async ({ ctx, input }) => {
        await updateEngineConfig(input.id, ctx.user.id, { name: input.name });
        return { success: true };
      }),
  }),

  community: router({
    // Get public community gallery
    list: publicProcedure
      .input(z.object({
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
      }).optional())
      .query(async ({ input }) => {
        const { limit, offset } = input || { limit: 20, offset: 0 };
        return getPublicConfigs(limit, offset);
      }),

    // Toggle upvote on a config
    upvote: protectedProcedure
      .input(z.object({ configId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const added = await toggleUpvote(ctx.user.id, input.configId);
        return { added };
      }),

    // Get user's upvoted config IDs
    myUpvotes: protectedProcedure.query(async ({ ctx }) => {
      return getUserUpvotes(ctx.user.id);
    }),

    // Publish a config to community
    publish: protectedProcedure
      .input(z.object({ configId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updateEngineConfig(input.configId, ctx.user.id, { isPublic: true });
        return { success: true };
      }),

    // Clone a community config into user's workspace
    clone: protectedProcedure
      .input(z.object({ configId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const original = await getConfigById(input.configId);
        if (!original) throw new Error("Config not found");
        
        const result = await saveEngineConfig(
          ctx.user.id,
          `${original.name} (Clone)`,
          original.config,
          original.description || undefined
        );
        return { id: result.id, success: true };
      }),
  }),

  export: router({
    // Create an export job and render server-side
    create: protectedProcedure
      .input(z.object({
        configId: z.number().nullable(),
        config: z.any(), // The engine configuration to render
        format: z.enum(['wav', 'mp3']),
        duration: z.number().min(1).max(120),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createExportJob(ctx.user.id, input.configId, input.format, input.duration);
        
        // Server-side rendering: generate audio and upload to storage
        // This runs asynchronously - we return the job ID immediately
        renderAndUpload(result.id, input.config, input.format, input.duration).catch((err: any) => {
          console.error('Export render failed:', err);
          updateExportJob(result.id, { status: 'failed', errorMessage: err.message });
        });
        
        return { jobId: result.id };
      }),

    // Get user's export jobs
    myJobs: protectedProcedure.query(async ({ ctx }) => {
      return getUserExportJobs(ctx.user.id);
    }),

    // Get a specific job status
    status: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        return getExportJobById(input.jobId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
