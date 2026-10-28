import { ArrowLeft, Compass } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { navigateToTab } from "@/lib/tabs";

export default function NotFoundPanel() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      action={{ label: "Back to Dashboard", icon: ArrowLeft, onClick: () => navigateToTab("dashboard") }}
    >
      <p className="max-w-sm text-sm text-muted-foreground">That link doesn’t match a screen in Archer. Check the URL or head home.</p>
    </EmptyState>
  );
}
