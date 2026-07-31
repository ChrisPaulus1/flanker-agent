import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        // Signal levels get their own variants so the styling lives in one
        // place and can't drift between the timeline and the detail view.
        // High and medium carry a soft gradient wash; low deliberately doesn't,
        // so the eye reads saturation as importance.
        high: "border-gold/40 bg-gradient-to-r from-grad-champagne/70 to-grad-blush/50 text-signal-high",
        medium: "border-signal-medium/25 bg-gradient-to-r from-grad-mist/70 to-grad-mist/40 text-signal-medium",
        low: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
