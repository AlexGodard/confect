// The Confect group with build-time compiled schema parsers installed before
// the group module evaluates.
// oxlint-disable-next-line import/no-unassigned-import -- Installing the parsers is the import's whole purpose.
import "../../confect/aotInstall";

export * from "./bench";
