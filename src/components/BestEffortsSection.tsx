import { Fragment, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { formatDisplayDate } from "@/lib/workouts/load";
import type {
  WorkoutBestEffort,
  WorkoutBestEffortEntry,
  WorkoutBestEffortsSummary,
} from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const BEST_EFFORT_COLUMN_WIDTHS = [
  "22%",
  "14%",
  "14%",
  "18%",
  "32%",
] as const;

export function BestEffortsSection({
  bestEfforts,
  className,
  onOpenWorkout,
}: {
  bestEfforts: WorkoutBestEffortsSummary;
  className?: string;
  onOpenWorkout: (slug: string) => void;
}) {
  if (bestEfforts.efforts.length === 0) {
    return null;
  }

  return (
    <section className={cn("border-t border-foreground/10 pt-6", className)}>
      <p className="eyebrow">Best Efforts</p>
      <BestEffortsDataTable
        className="mt-5"
        data={bestEfforts.efforts}
        onOpenWorkout={onOpenWorkout}
      />
    </section>
  );
}

function BestEffortsDataTable({
  className,
  data,
  onOpenWorkout,
}: {
  className?: string;
  data: WorkoutBestEffort[];
  onOpenWorkout: (slug: string) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "distanceMeters", desc: false }]);
  const [expandedEffortKey, setExpandedEffortKey] = useState<string | null>(null);
  const table = useReactTable({
    data,
    columns: createBestEffortColumns(onOpenWorkout),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  return (
    <div className={cn("overflow-hidden rounded-[1.25rem] border border-foreground/10 bg-background/85 shadow-sm shadow-primary/5", className)}>
      <Table className="table-fixed">
        <BestEffortsColGroup />
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {cell.column.id === "distanceMeters" ? (
                        <DistanceToggleButton
                          expanded={expandedEffortKey === row.original.key}
                          label={row.original.label}
                          expandable={row.original.topEfforts.length > 1}
                          onClick={() =>
                            setExpandedEffortKey((currentValue) =>
                              currentValue === row.original.key ? null : row.original.key,
                            )
                          }
                        />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {expandedEffortKey === row.original.key && row.original.topEfforts.length > 1 ? (
                  <TableRow key={`${row.id}-expanded`}>
                    <TableCell className="bg-surface-elevated/55 px-0 py-0" colSpan={row.getVisibleCells().length}>
                      <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
                        <ExpandedEffortsPanel
                          efforts={row.original.topEfforts}
                          onOpenWorkout={onOpenWorkout}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

function createBestEffortColumns(
  onOpenWorkout: (slug: string) => void,
): ColumnDef<WorkoutBestEffort>[] {
  return [
    {
      accessorKey: "distanceMeters",
      header: ({ column }) => (
        <SortableHeader
          label="Distance"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: () => null,
    },
    {
      accessorKey: "elapsedSeconds",
      header: ({ column }) => (
        <SortableHeader
          label="Time"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => <span className="font-medium text-foreground">{formatElapsedSeconds(row.original.elapsedSeconds)}</span>,
    },
    {
      accessorKey: "paceSecondsPerKm",
      header: ({ column }) => (
        <SortableHeader
          label="Pace"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{formatPaceSeconds(row.original.paceSecondsPerKm)} /km</span>
      ),
    },
    {
      accessorKey: "workoutDate",
      header: ({ column }) => (
        <SortableHeader
          label="Date"
          sorted={column.getIsSorted()}
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => <span className="text-muted-foreground">{formatDisplayDate(row.original.workoutDate)}</span>,
    },
    {
      accessorKey: "workoutTitle",
      header: "Workout",
      cell: ({ row }) => (
        <Button
          className="h-auto min-w-52 cursor-pointer justify-start px-0 py-0 text-left font-semibold text-foreground hover:text-primary hover:underline"
          type="button"
          variant="ghost"
          onClick={() => onOpenWorkout(row.original.workoutSlug)}
        >
          {row.original.workoutTitle}
        </Button>
      ),
    },
  ];
}

function DistanceToggleButton({
  expandable,
  expanded,
  label,
  onClick,
}: {
  expandable: boolean;
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "-ml-2 h-auto justify-start px-2 py-0 text-left font-semibold text-foreground",
        expandable ? "cursor-pointer hover:text-primary" : "cursor-default",
      )}
      disabled={!expandable}
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      {expandable ? (
        expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
      ) : (
        <span className="size-4" />
      )}
      {label}
    </Button>
  );
}

function ExpandedEffortsPanel({
  efforts,
  onOpenWorkout,
}: {
  efforts: WorkoutBestEffortEntry[];
  onOpenWorkout: (slug: string) => void;
}) {
  const additionalEfforts = efforts.slice(1);
  if (additionalEfforts.length === 0) {
    return null;
  }

  return (
    <Table className="table-fixed">
      <BestEffortsColGroup />
      <TableBody>
        {additionalEfforts.map((effort, index) => (
          <TableRow key={`${effort.workoutSlug}-${effort.elapsedSeconds}-${index + 1}`}>
            <TableCell />
            <TableCell className="font-medium text-foreground">{formatElapsedSeconds(effort.elapsedSeconds)}</TableCell>
            <TableCell className="font-medium text-foreground">{formatPaceSeconds(effort.paceSecondsPerKm)} /km</TableCell>
            <TableCell className="text-muted-foreground">{formatDisplayDate(effort.workoutDate)}</TableCell>
            <TableCell>
              <Button
                className="h-auto cursor-pointer justify-start px-0 py-0 text-left font-semibold text-foreground hover:text-primary hover:underline"
                type="button"
                variant="ghost"
                onClick={() => onOpenWorkout(effort.workoutSlug)}
              >
                {effort.workoutTitle}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BestEffortsColGroup() {
  return (
    <colgroup>
      {BEST_EFFORT_COLUMN_WIDTHS.map((width) => (
        <col key={width} style={{ width }} />
      ))}
    </colgroup>
  );
}

function SortableHeader({
  label,
  onClick,
  sorted,
}: {
  label: string;
  onClick: () => void;
  sorted: false | "asc" | "desc";
}) {
  return (
    <Button
      className="-ml-1 h-auto px-1 py-0 text-left text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ArrowUpDown className="size-3.5" />
      )}
    </Button>
  );
}

function formatElapsedSeconds(value: number) {
  const roundedValue = Math.max(0, Math.round(value));
  const hours = Math.floor(roundedValue / 3_600);
  const minutes = Math.floor((roundedValue % 3_600) / 60);
  const seconds = roundedValue % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceSeconds(value: number) {
  const roundedValue = Math.max(0, Math.round(value));
  const minutes = Math.floor(roundedValue / 60);
  const seconds = roundedValue % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
