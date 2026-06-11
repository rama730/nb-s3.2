import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";

export interface HydrationProgressBannerProps {
  projectId: string;
}

type HydrationProgress = { status: string; completed: number; total: number };

export function HydrationProgressBanner({ projectId }: HydrationProgressBannerProps) {
  const [hydration, setHydration] = useState<HydrationProgress | null>(null);
  
  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const fetchProgress = async () => {
      if (!active) return;
      const { data } = await supabase
        .from("projects")
        .select("import_source")
        .eq("id", projectId)
        .single();
      
      const meta = data?.import_source?.metadata?.hydration;
      if (meta && active) {
        setHydration(meta);
      }
    };

    // Initial fetch
    fetchProgress();

    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_hydration",
      resourceId: projectId,
      bindings: [
        {
          event: "UPDATE",
          table: "projects",
          filter: `id=eq.${projectId}`,
          handler: (payload) => {
            const nextProject = payload.new as { import_source?: { metadata?: { hydration?: HydrationProgress } } } | undefined;
            const importSource = nextProject?.import_source;
            const meta = importSource?.metadata?.hydration;
            if (meta && active) {
              setHydration(meta);
            }
          },
        },
      ],
    });

    // Fallback polling (guaranteed updates every 5s if realtime misses events)
    const interval = setInterval(fetchProgress, 5000);

    return () => {
      active = false;
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [projectId]);

  if (!hydration || hydration.status !== "in_progress") {
    return null;
  }

  const percent = hydration.total > 0 ? Math.floor((hydration.completed / hydration.total) * 100) : 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl animate-in slide-in-from-top-4 fade-in duration-300">
      <div className="bg-background/95 backdrop-blur-sm border shadow-lg rounded-lg p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚀</span>
            <span className="font-medium text-sm">Securing files in background...</span>
          </div>
          <Badge variant="secondary" className="font-mono">
            {hydration.completed.toLocaleString()} / {hydration.total.toLocaleString()}
          </Badge>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300 ease-out" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          You can freely view and edit files while this finishes.
        </p>
      </div>
    </div>
  );
}
