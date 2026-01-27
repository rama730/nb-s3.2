"use client";

// Placeholder
export default function CommandPalette(props: any) {
    if (!props.isOpen) return null
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
            <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg">
                <button onClick={props.onClose}>Close</button>
                <div className="mt-2">Command Palette Placeholder</div>
            </div>
        </div>
    )
}
