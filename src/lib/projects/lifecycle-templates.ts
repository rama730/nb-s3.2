/**
 * Lifecycle templates (5 stages) mapped from project_type.
 * Pure optimization: single source of truth used by UI + server defaults.
 */

export type LifecycleTemplateId =
  | "productWeb"
  | "openSourceTool"
  | "clientFreelance"
  | "hackathonLearning"
  | "creativeArt"
  | "media"
  | "gameDev";

export const LIFECYCLE_TEMPLATES: Record<LifecycleTemplateId, readonly string[]> = {
  productWeb: ["Discovery", "Design", "MVP Build", "Beta", "Launch & Iterate"],
  openSourceTool: ["Scope", "Prototype", "Alpha Release", "Community Feedback", "Stable Release"],
  clientFreelance: ["Requirements", "Design", "Implementation", "QA & Review", "Delivery"],
  hackathonLearning: ["Plan", "Build", "Iterate", "Polish", "Ship"],
  creativeArt: ["Concept", "Create", "Feedback", "Finalize", "Publish"],
  media: ["Plan", "Produce", "Edit", "Publish", "Promote"],
  gameDev: ["Concept", "Prototype", "Vertical Slice", "Beta", "Release"],
} as const;

/**
 * Maps the existing `project_type` ids to a lifecycle template.
 * Source of project types: `src/components/projects/create-wizard/phases/Phase1TypeSelection.tsx`
 */
export const PROJECT_TYPE_TO_TEMPLATE: Record<string, LifecycleTemplateId> = {
  // Product/Web
  side_project: "productWeb",
  startup: "productWeb",
  web_app: "productWeb",
  ecommerce: "productWeb",
  content: "productWeb",
  nonprofit: "productWeb",

  // Open source / tools
  open_source: "openSourceTool",
  tool: "openSourceTool",

  // Client
  freelance: "clientFreelance",

  // Learning / hackathon
  learning: "hackathonLearning",
  hackathon: "hackathonLearning",

  // Creative + media
  creative: "creativeArt",
  podcast: "media",
  video: "media",

  // Game
  game: "gameDev",
};

export function getLifecycleStagesForProjectType(projectType: string | null | undefined): string[] {
  const key = (projectType || "").trim();
  const templateId = PROJECT_TYPE_TO_TEMPLATE[key] || "productWeb";
  return [...LIFECYCLE_TEMPLATES[templateId]];
}

