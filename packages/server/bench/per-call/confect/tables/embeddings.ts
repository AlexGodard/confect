import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    setId: Schema.String,
    chunk: Schema.Finite,
    vector: Schema.Array(Schema.Finite),
  }),
).index("by_setId", ["setId"]);
