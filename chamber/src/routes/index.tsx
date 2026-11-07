import { createFileRoute } from "@tanstack/react-router";
import { BrainLab } from "@/components/brain-lab";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BrainLab />;
}
