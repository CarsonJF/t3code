import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../../native/native-glass";
import { useNativeColumnLayoutMetrics } from "../../../native/native-layout-metrics";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/** How far an empty workspace list keeps its message below a glass bar and its search. */
export function useWorkspaceListEmptyTopInset(): number {
  const insets = useSafeAreaInsets();
  return NATIVE_LIQUID_GLASS_SUPPORTED ? insets.top + 72 : 0;
}

/**
 * Where a workspace list's content ends: clear of the floating tab bar and its compose button,
 * or of the dock `bottomClearance` measures. A list the platform already insets subtracts the
 * safe area it counted.
 */
export function useWorkspaceListBottomInset(
  options: { readonly automaticBottomInset?: boolean } = {},
): number {
  const insets = useSafeAreaInsets();
  const workspace = useWorkspaceTabs();
  const bottomSafeArea = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const clearance = Math.max(Math.max(insets.bottom, 18) + 18, workspace?.bottomClearance ?? 0);
  return options.automaticBottomInset === true && Platform.OS === "ios"
    ? Math.max(0, clearance - bottomSafeArea)
    : clearance;
}
