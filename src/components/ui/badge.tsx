import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tracking-wide", {
  variants: {
    variant: {
      muted: "bg-elevated text-muted shadow-[var(--shadow-panel)]",
      call: "bg-call/15 text-call",
      put: "bg-put/15 text-put",
      warn: "bg-warn/15 text-warn",
      accent: "bg-accent/15 text-fg",
    },
  },
  defaultVariants: { variant: "muted" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
