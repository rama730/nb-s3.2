export const PROJECT_TYPE_OPTIONS = [
    { id: "side_project", label: "Side Project", description: "Personal project or hobby" },
    { id: "startup", label: "Startup", description: "Building a business" },
    { id: "open_source", label: "Open Source", description: "Community contribution" },
    { id: "learning", label: "Learning Project", description: "Skill development" },
    { id: "hackathon", label: "Hackathon", description: "Competition project" },
    { id: "freelance", label: "Freelance/Client", description: "Client work" },
    { id: "creative", label: "Creative/Art", description: "Art or design project" },
    { id: "nonprofit", label: "Non-Profit", description: "Social impact" },
    { id: "game", label: "Game Dev", description: "Video game project" },
    { id: "web_app", label: "Web App", description: "Web application" },
    { id: "ecommerce", label: "E-Commerce", description: "Online store" },
    { id: "tool", label: "Developer Tool", description: "Dev tools & utilities" },
    { id: "content", label: "Content/Blog", description: "Content platform" },
    { id: "podcast", label: "Podcast/Audio", description: "Audio content" },
    { id: "video", label: "Video/Media", description: "Video content" },
] as const;

export type ProjectTypeId = typeof PROJECT_TYPE_OPTIONS[number]["id"];

export const OTHER_PROJECT_TYPE_ID = "other";

export const POPULAR_PROJECT_TAGS = [
    "AI/ML",
    "Web3",
    "SaaS",
    "Mobile",
    "API",
    "Fintech",
    "EdTech",
    "HealthTech",
    "E-commerce",
    "DevTools",
];

export const POPULAR_PROJECT_TECH = [
    "React",
    "Next.js",
    "TypeScript",
    "Node.js",
    "Python",
    "PostgreSQL",
    "Tailwind",
    "Supabase",
    "Prisma",
    "GraphQL",
];

export function isKnownProjectType(value: string) {
    return value === OTHER_PROJECT_TYPE_ID || PROJECT_TYPE_OPTIONS.some((type) => type.id === value);
}
