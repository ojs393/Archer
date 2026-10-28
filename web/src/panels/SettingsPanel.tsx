import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, RotateCw, Settings } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Stepper, type StepperStep } from "@/components/Stepper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useSetup } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import { requestSetupWizard } from "@/lib/setupEvent";
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
  const queryClient = useQueryClient();
  const setup = useSetup();
  const reset = useMutation({
    mutationFn: () => api.post<SetupView>("/api/setup/reset"),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKeys.setup, view);
      // setupCompletedAt lives on settings too — keep wizard seed / UI in sync
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      requestSetupWizard();
    },
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
          <EmptyState
            icon={Settings}
            title="Could not load setup"
            action={{ label: "Retry", icon: RotateCw, onClick: () => void setup.refetch() }}
          />
        ) : (
          <Stepper steps={steps} current={firstOpen === -1 ? steps.length - 1 : firstOpen} />
        )}
      </Card>
      {setup.data ? (
        <Card className="flex flex-col items-center gap-4 p-6">
          <EmptyState
            icon={setup.data.complete ? CircleCheck : Settings}
            title={setup.data.complete ? "Setup complete" : "Setup not finished"}
          />
          <Button
            type="button"
            variant="secondary"
            loading={reset.isPending}
            onClick={() => reset.mutate()}
          >
            Re-run setup
          </Button>
        </Card>
      ) : null}
    </PanelShell>
  );
}
