import { install } from "./_generated/aotSchemas.js";
import { targets } from "./aotTargets";

install(targets().map(({ ast }) => ast));
