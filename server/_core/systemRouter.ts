import { router, publicProcedure } from "./trpc";

export const systemRouter = router({
  health: publicProcedure.query(() => ({ ok: true, service: "engine-sound-simulator" })),
});
