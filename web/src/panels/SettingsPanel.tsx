import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Settings } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Stepper, type StepperStep } from "@/components/Stepper";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { SetupView } from "@/lib/types";
import { PanelShell } from "./PanelShell";

const STEP_LABELS: Record<keyof SetupView["steps"], string> = {
  operator: "Operator",
  provider: "Provider",
  domain: "Domain",
  addresses: "Addresses",
  testInboxes: "Test inboxes",
};

export default function SettingsPanel() {
  const setup = useQuery({
    queryKey: queryKeys.setup,
    queryFn: ({ signal }) => api.get<SetupView>("/api/setup", { signal }),
  });
  const steps: StepperStep[] = setup.data
    ? (Object.keys(STEP_LABELS) as (keyof SetupView["steps"])[]).map((id) => ({
        id,
        label: STEP_LABELS[id],
        done: setup.data.steps[id] === true,
      }))
    : [];
  const firstOpen = steps.findIndex((s) => !s.done);

  return (
    <PanelShell title="Settings" info="Sender identity, mail provider and test inboxes.">
      <Card className="p-5">
        {setup.isPending ? (
          <Skeleton className="h-6 w-full" />
        ) : setup.isError ? (
          <EmptyState icon={Settings} title="Could not load setup" />
        ) : (
          <Stepper steps={steps} current={firstOpen === -1 ? steps.length - 1 : firstOpen} />
        )}
      </Card>
      {setup.data ? (
        <Card>
          <EmptyState icon={setup.data.complete ? CircleCheck : Settings} title={setup.data.complete ? "Setup complete" : "Setup not finished"} />
        </Card>
      ) : null}
    </PanelShell>
  );
}
