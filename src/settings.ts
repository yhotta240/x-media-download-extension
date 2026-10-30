export type Settings = {
  multipleMediaMode: "individual" | "zip";
  [key: string]: unknown;
};

export const DEFAULT_SETTINGS: Settings = { multipleMediaMode: "individual" };

export function normalizeSettings(value: unknown): Settings {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...stored,
    multipleMediaMode:
      "multipleMediaMode" in stored && stored.multipleMediaMode === "zip"
        ? "zip"
        : DEFAULT_SETTINGS.multipleMediaMode,
  };
}
