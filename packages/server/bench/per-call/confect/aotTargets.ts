// The schemas whose parsers the AOT prototype compiles at build time, in a
// fixed order. Building them here forces the lazy table and function schemas,
// so the runtime ASTs are the same objects the handlers later parse with.
import * as SchemaAST from "effect/SchemaAST";
import embeddings from "./_generated/tables/embeddings";
import tasks from "./_generated/tables/tasks";
import bench from "./groups/bench.spec";

type Codec = { readonly ast: SchemaAST.AST };
const decode = (schema: Codec) => ({
  ast: schema.ast,
  operations: ["decode" as const],
});
const encode = (schema: Codec) => ({
  ast: SchemaAST.flip(schema.ast),
  operations: ["decode" as const],
});

export const targets = () => [
  decode(tasks.Doc),
  decode(embeddings.Doc),
  encode(tasks.Fields),
  ...Object.values(bench.functions).flatMap((fn: any) => [
    decode(fn.functionProvenance.args),
    encode(fn.functionProvenance.returns),
  ]),
];
