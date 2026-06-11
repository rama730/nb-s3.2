export function generateProjectKey(title: string): string {
    // 1. Clean the title: remove special chars, extra spaces
    const clean = title.replace(/[^a-zA-Z0-9\s]/g, "").trim().toUpperCase();

    // 2. Split into words
    const words = clean.split(/\s+/).filter(Boolean);

    const firstWord = words[0];
    if (!firstWord) return "PRJ";

    if (words.length === 1) {
        // Single word: use first 2 chars (e.g., "APP" -> "AP") or 3 if short
        if (firstWord.length <= 2) return firstWord;
        return firstWord.substring(0, 2);
    } else {
        // Multiple words: use first letter of each word (e.g., "Next Board" -> "NB")
        // Limit to 3 chars max for readability
        let key = "";
        for (let i = 0; i < Math.min(words.length, 3); i++) {
            const w = words[i];
            if (w && w[0]) {
                key += w[0];
            }
        }
        return key || "PRJ";
    }
}

export function formatTaskId(projectKey: string | null | undefined, taskNumber: number | null | undefined): string {
    if (!projectKey || !taskNumber) return "";
    return `${projectKey}-${taskNumber}`;
}
