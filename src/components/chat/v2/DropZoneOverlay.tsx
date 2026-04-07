'use client';

import { Upload } from 'lucide-react';

interface DropZoneOverlayProps {
    visible: boolean;
}

export function DropZoneOverlay({ visible }: DropZoneOverlayProps) {
    if (!visible) return null;
    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-primary">
                <Upload className="h-10 w-10" />
                <span className="text-sm font-medium">Drop files to send</span>
            </div>
        </div>
    );
}
