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
      ) : feedback.data.available ? (
        <div className="flex flex-col gap-4 px-6 py-8">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-secondary-foreground">Complaints</p>
              <p className="text-3xl font-semibold tabular-nums">{feedback.data.complaints}</p>
            </div>
            <div>
              <p className="text-sm text-secondary-foreground">Permanent bounces (SNS)</p>
              <p className="text-3xl font-semibold tabular-nums">{feedback.data.bounces}</p>
            </div>
          </div>
          <p className="text-sm text-secondary-foreground">{feedback.data.reason}</p>
          <InfoHint label="About SES feedback">
            <ol className="list-decimal space-y-2 pl-4 text-sm text-secondary-foreground">
              {feedback.data.guidance.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </InfoHint>
        </div>
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
