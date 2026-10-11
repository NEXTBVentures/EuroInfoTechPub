export type ModuleState = {
  enabled: boolean;
  implementationStatus: "IMPLEMENTED" | "PLANNED";
};

export function assertModuleAvailable(
  moduleKey: string,
  state: ModuleState | null | undefined,
): void {
  if (!state || !state.enabled || state.implementationStatus !== "IMPLEMENTED") {
    throw new Error(`module_unavailable:${moduleKey}`);
  }
}
