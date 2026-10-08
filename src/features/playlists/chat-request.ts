import { z } from "zod";
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  targetTracks: z.number().int().min(1).max(100),
  revision: z.number().int().nonnegative(),
});
export const chatSubmissionSchema = chatRequestSchema.extend({ requestId: z.string().uuid().optional() });
