import { useEffect, useState } from "react";
import type { GraphEngineController } from "@/features/graph/engine-types";
import { createFallbackGraphEngine } from "@/features/graph/graph-engine-fallback";
import type { NoteGraphData } from "@/lib/graph/schema";

type GraphEngineFactory = (data: NoteGraphData) => GraphEngineController;

interface GraphModuleState {
  ready: boolean;
  createEngine: GraphEngineFactory;
  usingFallback: boolean;
  error: string | null;
}

export function useGraphWasm() {
  const [state, setState] = useState<GraphModuleState>({
    ready: true,
    createEngine: createFallbackGraphEngine,
    usingFallback: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const module = await import("@/features/graph/wasm/loader");
        if (cancelled || typeof module.createGraphEngine !== "function") {
          return;
        }

        const nextCreateEngine = module.createGraphEngine as GraphEngineFactory;
        const nextUsingFallback = module.usingFallback ?? false;
        setState((current) => {
          if (
            current.ready &&
            current.createEngine === nextCreateEngine &&
            current.usingFallback === nextUsingFallback &&
            current.error === null
          ) {
            return current;
          }

          return {
            ready: true,
            createEngine: nextCreateEngine,
            usingFallback: nextUsingFallback,
            error: null,
          };
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState((current) => {
          const nextError = error instanceof Error ? error.message : "Unable to load note graph WASM module.";
          if (
            current.ready &&
            current.createEngine === createFallbackGraphEngine &&
            current.usingFallback &&
            current.error === nextError
          ) {
            return current;
          }

          return {
            ready: true,
            createEngine: createFallbackGraphEngine,
            usingFallback: true,
            error: nextError,
          };
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
