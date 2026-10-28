import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, focusRing } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const overlayClass =
  "fixed inset-0 z-50 bg-zinc-950/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

/** Shared shell for Dialog and AlertDialog — fills the viewport safely, scrolls inside the panel. */
const panelClass = cn(
  "relative z-50 flex w-[min(100%,calc(100vw-2rem))] max-h-[calc(100dvh-1.5rem)] min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-6 shadow-lg",
  "max-w-xl break-words [overflow-wrap:anywhere]",
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus-visible:outline-none",
);
/** Tall multi-step wizards: fixed viewport height, scroll the body only. */
const wizardPanelClass =
  "h-[min(48rem,calc(100dvh-1.5rem))] gap-0 overflow-hidden p-0";
const viewportClass = "fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4";

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn(overlayClass, className)} {...props} />);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose = false, onOpenAutoFocus, onInteractOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className={viewportClass}>
      <DialogPrimitive.Content
        ref={ref}
        className={cn(panelClass, "outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0", className)}
        onOpenAutoFocus={(event) => {
          // Keep focus inside for a11y, but do not flash a ring on pointer-opened dialogs.
          onOpenAutoFocus?.(event);
          if (!event.defaultPrevented && document.documentElement.dataset.modality !== "keyboard") {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }
        }}
        onInteractOutside={(event) => {
          // Portaled Select / Popover menus live outside the dialog DOM; don't dismiss when using them.
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-radix-select-content], [data-radix-popper-content-wrapper], [role='listbox']")) {
            event.preventDefault();
          }
          onInteractOutside?.(event);
        }}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogPrimitive.Close
                className={cn(
                  "absolute right-3 top-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900",
                  focusRing,
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        )}
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky top-0 z-[1] -mx-6 -mt-6 flex shrink-0 flex-col gap-1.5 border-b border-border bg-background px-6 pb-4 pt-6 pr-12",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

/** Scrollable middle for tall wizards (pair with `wizardPanelClass` on DialogContent). */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-6 py-4", className)} {...props} />
);
DialogBody.displayName = "DialogBody";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky bottom-0 z-[1] -mx-6 -mb-6 mt-auto flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-background px-6 pb-6 pt-4 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold leading-tight text-foreground", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-secondary-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  overlayClass,
  panelClass,
  viewportClass,
  wizardPanelClass,
};
