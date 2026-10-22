import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import embeddings from "../_generated/tables/embeddings";
import tasks from "../_generated/tables/tasks";

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.publicQuery({
      name: "noopQuery",
      args: () => ({ nonce: Schema.Finite }),
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "noopMutation",
      args: () => ({ nonce: Schema.Finite }),
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "getById",
      args: () => ({ id: Id("tasks"), nonce: Schema.Finite }),
      returns: () => tasks.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "list",
      args: () => ({ projectId: Schema.String, nonce: Schema.Finite }),
      returns: () => Schema.Array(tasks.Doc),
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "listEmbeddings",
      args: () => ({ setId: Schema.String, nonce: Schema.Finite }),
      returns: () => Schema.Array(embeddings.Doc),
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "insert",
      args: () => ({ task: tasks.Fields }),
      returns: () => Id("tasks"),
    }),
  )
  .addFunction(
    FunctionSpec.publicMutation({
      name: "patch",
      args: () => ({
        id: Id("tasks"),
        status: Schema.Literals([
          "backlog",
          "todo",
          "in_progress",
          "done",
          "canceled",
        ]),
        priority: Schema.Finite,
      }),
      returns: () => Schema.Null,
    }),
  );
