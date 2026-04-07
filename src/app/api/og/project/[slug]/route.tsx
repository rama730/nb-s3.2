import { ImageResponse } from "next/og";

import { readProjectDetailMetadata } from "@/app/actions/project";

function trimCopy(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  let title = trimCopy(slug.replace(/[-_]+/g, " "), "Project");
  let description = "Build with Edge.";

  try {
    const result = await readProjectDetailMetadata({ slugOrId: slug, actorUserId: null });
    if (result.success) {
      title = trimCopy(result.data.title, "Project");
      description = trimCopy(result.data.shortDescription || result.data.description, "Build with Edge.");
    }
  } catch (error) {
    console.error("[project og route] failed to read project metadata", error);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px",
          background:
            "linear-gradient(135deg, rgb(15, 23, 42) 0%, rgb(37, 99, 235) 45%, rgb(14, 165, 233) 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: "rgba(255,255,255,0.92)",
            }}
          />
          Edge
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
          <div
            style={{
              fontSize: 74,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            {title}
          </div>
          <div
            style={{
              maxWidth: 880,
              fontSize: 30,
              lineHeight: 1.3,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            {description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "rgba(255,255,255,0.82)",
          }}
        >
          <div>Professional social network for builders</div>
          <div>edge</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
