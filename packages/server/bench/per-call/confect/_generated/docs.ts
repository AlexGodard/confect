import type { Document } from "@confect/server";
import type schemaDefinition from "./schema";

export type EmbeddingsDoc = Document.Document<typeof schemaDefinition, "embeddings">;
export type TasksDoc = Document.Document<typeof schemaDefinition, "tasks">;

export interface Docs {
  embeddings: EmbeddingsDoc;
  tasks: TasksDoc;
}
