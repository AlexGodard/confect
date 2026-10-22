/* oxlint-disable effecttsgo/async-function -- Plain Convex handlers are the baseline this bench measures Confect against. */
import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";

const statuses = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const;

export const tasks = mutation({
  args: { projectId: v.string(), count: v.number() },
  returns: v.array(v.id("tasks")),
  handler: async (ctx, { projectId, count }) => {
    const ids = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        // oxlint-disable-next-line no-await-in-loop -- Seeding inserts one document at a time on purpose.
        await ctx.db.insert("tasks", {
          projectId,
          title: `Task ${i}: mix the second verse and bounce stems`,
          ...(i % 2 === 0
            ? {
                description:
                  "Bounce the stems at 24-bit and upload them to the shared folder before Friday.",
              }
            : {}),
          status: statuses[i % statuses.length]!,
          priority: i % 5,
          ...(i % 3 === 0 ? { assigneeId: `user_${i % 17}` } : {}),
          labels: ["mix", i % 2 === 0 ? "urgent" : "later"],
          ...(i % 4 === 0 ? { estimate: 3 } : {}),
          dueAt: 1_790_000_000_000 + i * 86_400_000,
          ...(i % 5 === 0 ? { completedAt: 1_790_000_000_000 } : {}),
          archived: false,
          sortKey: `a${i.toString(36).padStart(4, "0")}`,
          metadata: {
            source: "bench",
            ...(i % 2 === 0 ? { externalId: `ext-${i}` } : {}),
          },
        }),
      );
    }
    return ids;
  },
});

export const embeddings = mutation({
  args: { setId: v.string(), count: v.number(), dimensions: v.number() },
  returns: v.null(),
  handler: async (ctx, { setId, count, dimensions }) => {
    for (let i = 0; i < count; i++) {
      const vector = Array.from(
        { length: dimensions },
        (_, j) => Math.sin(i * 31 + j) / 3,
      );
      // oxlint-disable-next-line no-await-in-loop -- Seeding inserts one document at a time on purpose.
      await ctx.db.insert("embeddings", { setId, chunk: i, vector });
    }
    return null;
  },
});
