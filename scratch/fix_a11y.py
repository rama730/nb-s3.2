import re

with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

old_div = """                                        <div
                                            className="flex-1 cursor-pointer"
                                            role="button"
                                            tabIndex={selectionMode ? -1 : 0}
                                            onClick={() => !selectionMode && openPreview(conn)}
                                            onKeyDown={(event) => {
                                                if (!selectionMode && (event.key === "Enter" || event.key === " ")) {
                                                    event.preventDefault();
                                                    openPreview(conn);
                                                }
                                            }}
                                        >"""

new_div = """                                        <div
                                            className="flex-1 cursor-pointer"
                                            onClick={() => !selectionMode && openPreview(conn)}
                                        >"""

content = content.replace(old_div, new_div)

with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

