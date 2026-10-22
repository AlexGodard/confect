import { GroupSpec, Spec } from "@confect/core";
import groups_bench from "../groups/bench.spec";

const spec: Spec.Spec<{
  readonly groups: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "groups", never, GroupSpec.NamedAt<typeof groups_bench, "bench">>, "groups">;
}> = Spec.fromGroups({
  ["groups"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["bench"]: groups_bench,
  }),
}) as typeof spec;

export default spec;
