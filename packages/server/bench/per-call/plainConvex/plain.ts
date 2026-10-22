/* oxlint-disable effecttsgo/async-function -- Plain Convex handlers are the baseline this bench measures Confect against. */
import {
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { v } from "convex/values";

const status = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("canceled"),
);

const taskFields = {
  projectId: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  status,
  priority: v.number(),
  assigneeId: v.optional(v.string()),
  labels: v.array(v.string()),
  estimate: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  archived: v.boolean(),
  sortKey: v.string(),
  metadata: v.object({
    source: v.string(),
    externalId: v.optional(v.string()),
  }),
};

const taskDoc = v.object({
  _id: v.id("tasks"),
  _creationTime: v.number(),
  ...taskFields,
});

const embeddingDoc = v.object({
  _id: v.id("embeddings"),
  _creationTime: v.number(),
  setId: v.string(),
  chunk: v.number(),
  vector: v.array(v.number()),
});

export const noopQuery = query({
  args: { nonce: v.number() },
  returns: v.null(),
  handler: async () => null,
});

export const noopMutation = mutation({
  args: { nonce: v.number() },
  returns: v.null(),
  handler: async () => null,
});

export const getById = query({
  args: { id: v.id("tasks"), nonce: v.number() },
  returns: taskDoc,
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (doc === null) throw new Error("not found");
    return doc;
  },
});

export const list = query({
  args: { projectId: v.string(), nonce: v.number() },
  returns: v.array(taskDoc),
  handler: async (ctx, { projectId }) =>
    ctx.db
      .query("tasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
});

export const listEmbeddings = query({
  args: { setId: v.string(), nonce: v.number() },
  returns: v.array(embeddingDoc),
  handler: async (ctx, { setId }) =>
    ctx.db
      .query("embeddings")
      .withIndex("by_setId", (q) => q.eq("setId", setId))
      .collect(),
});

export const insert = mutation({
  args: { task: v.object(taskFields) },
  returns: v.id("tasks"),
  handler: async (ctx, { task }) => ctx.db.insert("tasks", task),
});

export const patch = mutation({
  args: { id: v.id("tasks"), status, priority: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, status: nextStatus, priority }) => {
    await ctx.db.patch(id, { status: nextStatus, priority });
    return null;
  },
});
