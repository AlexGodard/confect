import { defineSchema as $defineSchema } from "convex/server";
import { Table as $Table } from "@confect/server";

import embeddings from "./tables/embeddings";
import tasks from "./tables/tasks";

export default $defineSchema({
  embeddings: $Table.tableDefinition(embeddings),
  tasks: $Table.tableDefinition(tasks),
});
