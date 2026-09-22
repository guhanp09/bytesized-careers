export type DraftDataMode = "live" | "demo" | "auth_error";

/**
 * Private drafts fail closed: absent backend authority is an authentication
 * error, never permission to display or mutate sample records. Demo data needs
 * both the server's non-production capability and an explicit/local-mock opt-in.
 */
export const resolveDraftDataMode = ({
  allowDemo,
  demoRequested,
  localMocksEnabled,
  demoDataAvailable,
  hasBackendToken,
}: {
  allowDemo: boolean;
  demoRequested: boolean;
  localMocksEnabled: boolean;
  demoDataAvailable: boolean;
  hasBackendToken: boolean;
}): DraftDataMode => {
  if (
    allowDemo &&
    demoDataAvailable &&
    (demoRequested || localMocksEnabled)
  ) {
    return "demo";
  }
  return hasBackendToken ? "live" : "auth_error";
};
