const asEnabledDefault = (value: string | undefined) =>
  value === "0" || value === "false" ? false : true;

const legacyFlags = {
  wave1ModularRuntime: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE1_MODULAR_RUNTIME),
  wave1ConflictUi: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE1_CONFLICT_UI),
  wave1SaveAll: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE1_SAVE_ALL),
  wave2HybridSearch: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE2_HYBRID_SEARCH),
  wave2StoreBatching: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE2_STORE_BATCHING),
  wave2PrefetchHover: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE2_PREFETCH_HOVER),
  wave2AsyncIndexQueue: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE2_ASYNC_INDEX_QUEUE),
  wave3UiEnhancements: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE3_UI_ENHANCEMENTS),
  wave3ContextIsolation: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE3_CONTEXT_ISOLATION),
  wave3OpsHardening: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE3_OPS_HARDENING),
  wave4GitIntegration: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE4_GIT_INTEGRATION),
  wave4Terminal: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE4_TERMINAL),
  wave4AssetGallery: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE4_ASSET_GALLERY),
  wave4BottomPanel: asEnabledDefault(process.env.NEXT_PUBLIC_FILES_WAVE4_BOTTOM_PANEL),
} as const;

// Capability flags are the long-term surface.
// Legacy wave flags remain for one release cycle as compatibility fallbacks.
const capabilityOverrides = {
  searchHybrid: process.env.NEXT_PUBLIC_FILES_SEARCH_HYBRID,
  storeBatching: process.env.NEXT_PUBLIC_FILES_STORE_BATCHING,
  prefetchHover: process.env.NEXT_PUBLIC_FILES_PREFETCH_HOVER,
  indexAsyncQueue: process.env.NEXT_PUBLIC_FILES_INDEX_ASYNC_QUEUE,
  uiEnhanced: process.env.NEXT_PUBLIC_FILES_UI_ENHANCED,
} as const;

export const filesFeatureFlags = {
  ...legacyFlags,
  searchHybrid:
    capabilityOverrides.searchHybrid !== undefined
      ? asEnabledDefault(capabilityOverrides.searchHybrid)
      : legacyFlags.wave2HybridSearch,
  storeBatching:
    capabilityOverrides.storeBatching !== undefined
      ? asEnabledDefault(capabilityOverrides.storeBatching)
      : legacyFlags.wave2StoreBatching,
  prefetchHover:
    capabilityOverrides.prefetchHover !== undefined
      ? asEnabledDefault(capabilityOverrides.prefetchHover)
      : legacyFlags.wave2PrefetchHover,
  indexAsyncQueue:
    capabilityOverrides.indexAsyncQueue !== undefined
      ? asEnabledDefault(capabilityOverrides.indexAsyncQueue)
      : legacyFlags.wave2AsyncIndexQueue,
  uiEnhanced:
    capabilityOverrides.uiEnhanced !== undefined
      ? asEnabledDefault(capabilityOverrides.uiEnhanced)
      : legacyFlags.wave3UiEnhancements,
} as const;
