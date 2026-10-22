import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../groups/bench.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../groups/bench.spec")["default"]>(databaseSchema, groupLayer);

export default {
["noopQuery"]: RegisteredConvexFunction.register({ ...definitions["noopQuery"], handler: forward(definitions["noopQuery"].handler) }),
["noopMutation"]: RegisteredConvexFunction.register({ ...definitions["noopMutation"], handler: forward(definitions["noopMutation"].handler) }),
["getById"]: RegisteredConvexFunction.register({ ...definitions["getById"], handler: forward(definitions["getById"].handler) }),
["list"]: RegisteredConvexFunction.register({ ...definitions["list"], handler: forward(definitions["list"].handler) }),
["listEmbeddings"]: RegisteredConvexFunction.register({ ...definitions["listEmbeddings"], handler: forward(definitions["listEmbeddings"].handler) }),
["insert"]: RegisteredConvexFunction.register({ ...definitions["insert"], handler: forward(definitions["insert"].handler) }),
["patch"]: RegisteredConvexFunction.register({ ...definitions["patch"], handler: forward(definitions["patch"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../groups/bench.spec")["default"]>;
