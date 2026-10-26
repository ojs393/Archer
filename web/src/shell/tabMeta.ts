import { FileText, LayoutDashboard, Send, Settings, Users, type LucideIcon } from "lucide-react";
import type { TabId } from "@/lib/tabs";

export const TAB_META: Record<TabId, { label: string; icon: LucideIcon }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  runs: { label: "Runs", icon: Send },
  audience: { label: "Audience", icon: Users },
  templates: { label: "Templates", icon: FileText },
  settings: { label: "Settings", icon: Settings },
};
