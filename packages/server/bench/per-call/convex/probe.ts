/* oxlint-disable effecttsgo/async-function -- Plain Convex handlers are the baseline this bench measures Confect against. */
import { queryGeneric as query } from "convex/server";
import { v } from "convex/values";

// Reports which runtime facilities the default runtime exposes to a query.
export const runtime = query({
  args: {},
  returns: v.any(),
  handler: async () => {
    const attempt = (run: () => unknown) => {
      try {
        return { ok: true, value: String(run()) };
      } catch (error) {
        return { ok: false, value: String(error) };
      }
    };
    return {
      // oxlint-disable-next-line no-implied-eval -- The probe checks whether the runtime allows it.
      newFunction: attempt(() => new Function("return 1 + 1")()),
      // oxlint-disable-next-line no-eval -- The probe checks whether the runtime allows it.
      evalCall: attempt(() => (0, eval)("1 + 1")),
      performanceNow: attempt(
        () => typeof (globalThis as any).performance?.now,
      ),
      process: attempt(() => typeof (globalThis as any).process),
    };
  },
});
