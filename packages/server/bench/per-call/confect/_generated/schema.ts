import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import embeddings from "./tables/embeddings";
import tasks from "./tables/tasks";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly embeddings: typeof embeddings;
  readonly tasks: typeof tasks;
}> = $DatabaseSchema.make({
  embeddings,
  tasks,
});

export default databaseSchema;
