import type { ProjectNode } from "@/lib/db/schema";

export type LinkedTaskFileNode = ProjectNode & {
  order?: number;
  annotation?: string | null;
};

export function mergeLinkedNodesWithAnnotationOverrides(
  nodes: LinkedTaskFileNode[],
  annotationOverrides: Record<string, string | null>,
): LinkedTaskFileNode[] {
  if (Object.keys(annotationOverrides).length === 0) return nodes;
  return nodes.map((node) =>
    Object.prototype.hasOwnProperty.call(annotationOverrides, node.id)
      ? { ...node, annotation: annotationOverrides[node.id] }
      : node,
  );
}

export function pruneSettledAnnotationOverrides(
  nodes: LinkedTaskFileNode[],
  annotationOverrides: Record<string, string | null>,
): Record<string, string | null> {
  if (Object.keys(annotationOverrides).length === 0) return annotationOverrides;

  const nextOverrides: Record<string, string | null> = {};
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const [nodeId, override] of Object.entries(annotationOverrides)) {
    if (!nodeIds.has(nodeId)) continue;
    const matchingNode = nodes.find((node) => node.id === nodeId);
    if (!matchingNode) continue;
    if ((matchingNode.annotation ?? null) === override) continue;
    nextOverrides[nodeId] = override;
  }

  return nextOverrides;
}
