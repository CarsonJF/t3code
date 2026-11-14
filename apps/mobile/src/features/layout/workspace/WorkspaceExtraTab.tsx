import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { TotsTabScreen } from "../../tots/TotsTabScreen";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";

export function WorkspaceExtraTab(props: { tab: Extract<NavigationTab, "tots" | "usage"> }) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "tots" ? <TotsTabScreen /> : <UsageRouteScreen workspace />}
    </>
  );
}
