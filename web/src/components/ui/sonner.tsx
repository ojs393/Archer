import type * as React from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      visibleToasts={4}
      closeButton
      toastOptions={{
        classNames: {
          toast: "group rounded-lg border border-border bg-background text-foreground shadow-md text-sm",
          title: "font-medium",
          description: "text-secondary-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-zinc-100 !text-zinc-900",
          closeButton: "!border-0 !bg-background !text-zinc-600 hover:!text-zinc-900",
        },
      }}
      {...props}
    />
  );
}

export { toast, Toaster };
