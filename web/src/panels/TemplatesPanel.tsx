import { FileText } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { CollectionPanel } from "./CollectionPanel";

export default function TemplatesPanel() {
  return (
    <CollectionPanel
      title="Templates"
      icon={FileText}
      queryKey={queryKeys.templates}
      path="/api/templates"
      countLabel="Templates"
      emptyTitle="No templates yet"
    />
  );
}
