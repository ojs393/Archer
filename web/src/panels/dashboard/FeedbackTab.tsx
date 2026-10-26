import { MessageSquareWarning } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/InfoHint";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsFeedback } from "@/lib/queries/analytics";

export function FeedbackTab() {
  const feedback = useAnalyticsFeedback();

  return (
    <Card>
      {feedback.isPending ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : feedback.isError || !feedback.data ? (
        <EmptyState icon={MessageSquareWarning} title="Could not load feedback" />
      ) : (
        <EmptyState icon={MessageSquareWarning} title={feedback.data.reason}>
          <InfoHint label="How to connect SES feedback">
            <ol className="list-decimal space-y-2 pl-4 text-sm text-secondary-foreground">
              {feedback.data.guidance.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </InfoHint>
        </EmptyState>
      )}
    </Card>
  );
}
