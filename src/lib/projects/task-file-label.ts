export function extractLabel(annotation: string | null | undefined): string | null {
  if (!annotation) return null;
  const parts = annotation.split("#");
  const label = parts[0]?.trim() || null;
  return label;
}

export function composeAnnotation(
  label: string | null,
  existingAnnotation: string | null | undefined
): string | null {
  const cleanLabel = label?.trim() || "";
  
  const existingTags: string[] = [];
  if (existingAnnotation) {
    const parts = existingAnnotation.split(/(?=#)/);
    for (const part of parts) {
      if (part.trim().startsWith("#")) {
        existingTags.push(part.trim());
      }
    }
  }

  if (!cleanLabel && existingTags.length === 0) {
    return null;
  }

  if (!cleanLabel) {
    return existingTags.join(" ");
  }

  if (existingTags.length === 0) {
    return cleanLabel;
  }

  return `${cleanLabel} ${existingTags.join(" ")}`;
}
