import { useEffect, useState, type ComponentType } from "react";
import type { ChamberProps } from "@/components/immersive-chamber";

export function ChamberHost(props: ChamberProps) {
  const [View, setView] = useState<ComponentType<ChamberProps> | null>(null);

  useEffect(() => {
    let live = true;
    void import("@/components/immersive-chamber").then((mod) => {
      if (live) setView(() => mod.ImmersiveChamber);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!View) {
    return (
      <div className="h-full w-full bg-bg">
        <canvas className="block h-full w-full touch-none" aria-hidden="true" />
      </div>
    );
  }
  return <View {...props} />;
}
