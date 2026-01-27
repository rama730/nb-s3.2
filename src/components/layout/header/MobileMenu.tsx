"use client";

// Placeholder
export default function MobileMenu(props: any) {
    if (!props.isOpen) return null
    return (
        <div className="fixed inset-0 z-50 bg-white dark:bg-zinc-900 p-4">
            <button onClick={props.onClose} className="mb-4">Close</button>
            <div>Mobile Menu Placeholder</div>
        </div>
    )
}
