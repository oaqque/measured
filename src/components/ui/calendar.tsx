import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  navLayout = "around",
  showOutsideDays = false,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      className={cn("w-[18rem] p-3", className)}
      classNames={{
        months: "flex flex-col gap-3",
        month: "relative",
        month_caption: "relative mx-9 flex h-10 items-center justify-center",
        caption_label:
          "text-center text-sm font-semibold leading-none whitespace-nowrap text-foreground",
        nav: "absolute inset-y-0 inset-x-0 flex items-center justify-between",
        button_previous:
          "absolute top-0 left-0 inline-flex size-9 shrink-0 items-center justify-center rounded-[0.3rem] bg-transparent p-0 text-muted-foreground transition-colors hover:bg-surface-panel-alt/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
        button_next:
          "absolute top-0 right-0 inline-flex size-9 shrink-0 items-center justify-center rounded-[0.3rem] bg-transparent p-0 text-muted-foreground transition-colors hover:bg-surface-panel-alt/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
        month_grid: "mt-3 w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 text-center text-[10px] font-extrabold uppercase text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "size-9 p-0 text-sm",
        day_button:
          "inline-flex size-9 items-center justify-center rounded-[0.35rem] bg-transparent p-0 text-sm font-medium text-foreground transition-colors hover:bg-surface-panel-alt/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
        selected:
          "bg-primary text-primary-foreground [&>button]:text-primary-foreground [&>button:hover]:bg-transparent [&>button:hover]:text-primary-foreground",
        today: "bg-surface-panel-alt/55 text-foreground",
        outside: "text-muted-foreground/40 opacity-50",
        disabled: "text-muted-foreground/35 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      navLayout={navLayout}
      components={{
        Chevron: ({ orientation, className: iconClassName, ...iconProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-[18px]", iconClassName)} {...iconProps} />
          ) : (
            <ChevronRight className={cn("size-[18px]", iconClassName)} {...iconProps} />
          ),
      }}
      showOutsideDays={showOutsideDays}
      {...props}
    />
  );
}
