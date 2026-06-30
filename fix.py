import re

with open("/Users/chrama/Downloads/nb-s3/src/components/projects/updates/ProjectUpdateComposer.tsx", "r") as f:
    content = f.read()

# 1. Import ProjectReadmeReferencePicker
import_stmt = "import { ProjectReadmeReferencePicker } from \"@/components/projects/readme/ProjectReadmeReferencePicker\";\nimport type { ProjectReadmeReferenceKind } from \"@/lib/projects/readme-blocks\";\n"
if "ProjectReadmeReferencePicker" not in content:
    content = content.replace(
        "import { MultiAttachmentPicker }",
        import_stmt + "import { MultiAttachmentPicker }"
    )

# 2. Add state and ref
state_code = """    const [mentionPickerOpen, setMentionPickerOpen] = useState<ProjectReadmeReferenceKind | "all" | null>(null);
    const editorRef = useRef<{ insertTextAtCursor: (t: string) => void } | null>(null);

"""
if "mentionPickerOpen" not in content:
    content = content.replace("    const [filePickerOpen, setFilePickerOpen] = useState(false);", "    const [filePickerOpen, setFilePickerOpen] = useState(false);\n" + state_code)

# 3. Handle onCommand from editor
editor_jsx = """                        <ProjectUpdateRichTextEditor
                            content={draft}
                            placeholder="What's the latest update on this project?"
                            onChange={setDraft}
                            editorRef={editorRef}
                            onCommand={(kind) => {
                                const mappedKind = (kind + "s") as ProjectReadmeReferenceKind;
                                setMentionPickerOpen(mappedKind);
                            }}
                        />"""
content = re.sub(r"""\s*<ProjectUpdateRichTextEditor[\s\S]*?onCommand=\{\(kind\) => openPanel\(kind\)\}\s*/>""", f"\n{editor_jsx}", content)

# 4. Add the Mention Picker JSX
picker_jsx = """
            {mentionPickerOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => {
                    if (e.target === e.currentTarget) setMentionPickerOpen(null);
                }}>
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl">
                        <ProjectReadmeReferencePicker
                            projectId={projectId}
                            initialKind={mentionPickerOpen === "all" ? undefined : mentionPickerOpen}
                            onInsert={(text) => {
                                editorRef.current?.insertTextAtCursor(text + " ");
                                setMentionPickerOpen(null);
                            }}
                            onClose={() => setMentionPickerOpen(null)}
                        />
                    </div>
                </div>
            ) : null}
"""
content = content.replace("            <MultiAttachmentPicker", picker_jsx + "            <MultiAttachmentPicker")

with open("/Users/chrama/Downloads/nb-s3/src/components/projects/updates/ProjectUpdateComposer.tsx", "w") as f:
    f.write(content)

print("Mentions picker integrated!")
