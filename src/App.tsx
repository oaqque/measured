import { CalendarRange, Dumbbell, House, NotebookText } from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";
import { CalendarPage } from "@/pages/CalendarPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { PlanPage } from "@/pages/PlanPage";
import { WorkoutDetailPage } from "@/pages/WorkoutDetailPage";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Overview", icon: House },
  { to: "/calendar", label: "Calendar", icon: CalendarRange },
  { to: "/plan", label: "Plan", icon: NotebookText },
];

export default function App() {
  return (
    <div className="min-h-screen bg-page text-foreground">
      <header className="sticky top-0 z-20 px-4 pt-4 md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-[2rem] bg-background/92 px-5 py-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-[1.25rem] bg-surface-hero text-foreground">
              <Dumbbell className="size-5" />
            </div>
            <div>
              <p className="eyebrow">Training Web</p>
              <p className="text-sm font-semibold text-foreground">Static workout viewer</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                className={({ isActive }) =>
                  cn("nav-link", isActive ? "bg-primary text-primary-foreground" : "")
                }
                to={to}
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 md:px-6 md:py-8">
        <Routes>
          <Route element={<OverviewPage />} path="/" />
          <Route element={<CalendarPage />} path="/calendar" />
          <Route element={<PlanPage />} path="/plan" />
          <Route element={<WorkoutDetailPage />} path="/workouts/:slug" />
          <Route element={<OverviewPage />} path="*" />
        </Routes>
      </main>
    </div>
  );
}
