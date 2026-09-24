import { createFileRoute } from "@tanstack/react-router";
import { LabShell } from "@/components/lab/lab-shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <LabShell />;
}
