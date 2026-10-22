import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    projectId: Schema.String,
    title: Schema.String,
    description: Schema.optionalKey(Schema.String),
    status: Schema.Literals([
      "backlog",
      "todo",
      "in_progress",
      "done",
      "canceled",
    ]),
    priority: Schema.Finite,
    assigneeId: Schema.optionalKey(Schema.String),
    labels: Schema.Array(Schema.String),
    estimate: Schema.optionalKey(Schema.Finite),
    dueAt: Schema.optionalKey(Schema.Finite),
    completedAt: Schema.optionalKey(Schema.Finite),
    archived: Schema.Boolean,
    sortKey: Schema.String,
    metadata: Schema.Struct({
      source: Schema.String,
      externalId: Schema.optionalKey(Schema.String),
    }),
  }),
).index("by_projectId", ["projectId"]);
