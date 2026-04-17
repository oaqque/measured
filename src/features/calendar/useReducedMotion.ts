import { useMediaQuery } from "@/features/calendar/useMediaQuery";

export function useReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
