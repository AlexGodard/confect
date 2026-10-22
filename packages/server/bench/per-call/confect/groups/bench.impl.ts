import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import bench from "./bench.spec";

const noopQuery = FunctionImpl.make(databaseSchema, bench, "noopQuery", () =>
  Effect.succeed(null),
);

const noopMutation = FunctionImpl.make(
  databaseSchema,
  bench,
  "noopMutation",
  () => Effect.succeed(null),
);

const getById = FunctionImpl.make(databaseSchema, bench, "getById", ({ id }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader.table("tasks").get(id);
  }).pipe(Effect.orDie),
);

const list = FunctionImpl.make(databaseSchema, bench, "list", ({ projectId }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("tasks")
      .index("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  }).pipe(Effect.orDie),
);

const listEmbeddings = FunctionImpl.make(
  databaseSchema,
  bench,
  "listEmbeddings",
  ({ setId }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      return yield* reader
        .table("embeddings")
        .index("by_setId", (q) => q.eq("setId", setId))
        .collect();
    }).pipe(Effect.orDie),
);

const insert = FunctionImpl.make(databaseSchema, bench, "insert", ({ task }) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer.table("tasks").insert(task);
  }).pipe(Effect.orDie),
);

const patch = FunctionImpl.make(
  databaseSchema,
  bench,
  "patch",
  ({ id, status, priority }) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writer.table("tasks").patch(id, { status, priority });
      return null;
    }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, bench).pipe(
  Layer.provide(noopQuery),
  Layer.provide(noopMutation),
  Layer.provide(getById),
  Layer.provide(list),
  Layer.provide(listEmbeddings),
  Layer.provide(insert),
  Layer.provide(patch),
  GroupImpl.finalize,
);
