import { useEffect, useMemo, useRef, useState } from "react";
import { parseGraphChatTurnResult } from "@/lib/graph/chat-schema";
import type { GraphClusterMode, GraphOp, NoteGraphData } from "@/lib/graph/schema";
import { applyGraphOps, getPersistentGraphOps } from "@/features/graph/graph-ops";
import { graphTelemetry } from "@/features/graph/telemetry";

type BackendStatus = "checking" | "ready" | "unavailable";

interface HealthResponse {
  ok: boolean;
  authenticated: boolean;
  backend: string;
}

interface SessionResponse {
  sessionId: string;
}

interface PersistOpsResponse {
  ok: boolean;
  graph: NoteGraphData;
}

interface SessionEventMessage {
  type: "status" | "delta" | "turnResult" | "error";
  text?: string;
  payload?: string;
}

const CLUSTER_MODE_KEY = "measured.noteGraph.clusterMode";
const AUTHORED_ONLY_KEY = "measured.noteGraph.authoredOnly";

export function useGraphSession(initialGraphData: NoteGraphData) {
  const [assistantText, setAssistantText] = useState<string | null>(null);
  const [backendLabel, setBackendLabel] = useState("Checking local Codex backend...");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [clusterMode, setClusterMode] = useState<GraphClusterMode>(() => readStoredClusterMode());
  const [graphData, setGraphData] = useState(initialGraphData);
  const [paused, setPaused] = useState(false);
  const [pendingOps, setPendingOps] = useState<GraphOp[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showAuthoredOnly, setShowAuthoredOnly] = useState(readStoredAuthoredOnly());
  const [streamingText, setStreamingText] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    window.localStorage.setItem(CLUSTER_MODE_KEY, clusterMode);
  }, [clusterMode]);

  useEffect(() => {
    window.localStorage.setItem(AUTHORED_ONLY_KEY, String(showAuthoredOnly));
  }, [showAuthoredOnly]);

  useEffect(() => {
    let cancelled = false;

    const loadHealth = async () => {
      try {
        const response = await fetch("/api/graph-chat/health", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Health request failed with ${response.status}`);
        }

        const payload = (await response.json()) as HealthResponse;
        if (cancelled) {
          return;
        }

        setBackendStatus(payload.ok ? "ready" : "unavailable");
        setBackendLabel(
          payload.ok
            ? payload.authenticated
              ? "Codex graph backend connected"
              : "Codex graph backend needs authentication"
            : payload.backend || "Local Codex backend unavailable",
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setBackendStatus("unavailable");
        setBackendLabel(error instanceof Error ? error.message : "Local Codex backend unavailable");
      }
    };

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const pendingPersistentOps = useMemo(() => getPersistentGraphOps(pendingOps), [pendingOps]);

  const sendMessage = async (message: string) => {
    if (backendStatus !== "ready") {
      return;
    }

    const ensuredSessionId = await ensureSession();
    if (!ensuredSessionId) {
      return;
    }

    setBusy(true);
    setStreamingText("");
    setAssistantText(null);
    setPendingOps([]);
    graphTelemetry.recordChatTurnStart();

    await fetch(`/api/graph-chat/session/${ensuredSessionId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        graphContext: {
          clusterMode,
          nodeCount: graphData.nodes.length,
          linkCount: graphData.links.length,
          authoredLinkCount: graphData.links.filter((link) => link.sourceType === "authored").length,
          selectedNodeSlug: null,
        },
      }),
    });
  };

  const interrupt = async () => {
    if (!sessionId) {
      return;
    }

    await fetch(`/api/graph-chat/session/${sessionId}/interrupt`, {
      method: "POST",
    });
    setBusy(false);
  };

  const applyPending = async () => {
    if (pendingPersistentOps.length === 0) {
      if (pendingOps.length > 0) {
        const applied = applyGraphOps(graphData, pendingOps);
        setGraphData(applied.data);
        if (applied.clusterMode) {
          setClusterMode(applied.clusterMode);
        }
        setPendingOps([]);
      }
      return;
    }

    const response = await fetch("/api/graph-chat/graph/ops/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: pendingPersistentOps }),
    });
    if (!response.ok) {
      graphTelemetry.recordPersistResult(pendingPersistentOps.length, false);
      return;
    }

    const payload = (await response.json()) as PersistOpsResponse;
    if (payload.ok) {
      graphTelemetry.recordPersistResult(pendingPersistentOps.length, true);
      setGraphData(payload.graph);
      const persistentOpsSet = new Set<GraphOp>(pendingPersistentOps);
      const nonPersistentOps = pendingOps.filter((op) => !persistentOpsSet.has(op));
      if (nonPersistentOps.length > 0) {
        const applied = applyGraphOps(payload.graph, nonPersistentOps);
        setGraphData(applied.data);
        if (applied.clusterMode) {
          setClusterMode(applied.clusterMode);
        }
      }
      setPendingOps([]);
    }
  };

  return {
    assistantText,
    backendLabel,
    backendReady: backendStatus === "ready",
    busy,
    clusterMode,
    graphData,
    paused,
    pendingOps,
    pendingPersistentOps,
    setClusterMode,
    setGraphData,
    setPaused,
    setShowAuthoredOnly,
    showAuthoredOnly,
    streamingText,
    applyPending,
    interrupt,
    sendMessage,
  };

  async function ensureSession() {
    if (sessionId) {
      return sessionId;
    }

    const response = await fetch("/api/graph-chat/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      setBackendStatus("unavailable");
      setBackendLabel(`Unable to create Codex graph session (${response.status})`);
      return null;
    }

    const payload = (await response.json()) as SessionResponse;
    setSessionId(payload.sessionId);
    openEventSource(payload.sessionId);
    return payload.sessionId;
  }

  function openEventSource(nextSessionId: string) {
    eventSourceRef.current?.close();
    const nextSource = new EventSource(`/api/graph-chat/session/${nextSessionId}/events`);
    eventSourceRef.current = nextSource;
    nextSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as SessionEventMessage;

      if (payload.type === "status") {
        if (payload.text) {
          setBackendLabel(payload.text);
        }
        return;
      }

      if (payload.type === "delta") {
        setStreamingText((current) => current + (payload.text ?? ""));
        return;
      }

      if (payload.type === "turnResult" && payload.payload) {
        const result = parseGraphChatTurnResult(payload.payload);
        setBusy(false);
        if (!result) {
          graphTelemetry.recordChatError("turnResult payload was not valid JSON");
          setAssistantText(payload.payload);
          setStreamingText("");
          return;
        }

        graphTelemetry.recordChatTurnComplete();
        setAssistantText(result.assistantText);
        setStreamingText("");

        const immediateOps = result.ops.filter(isImmediateGraphOp);
        if (immediateOps.length > 0) {
          const applied = applyGraphOps(graphData, immediateOps);
          setGraphData(applied.data);
          if (applied.clusterMode) {
            setClusterMode(applied.clusterMode);
          }
        }

        const immediateOpsSet = new Set<GraphOp>(immediateOps);
        const deferredOps = result.ops.filter((op) => !immediateOpsSet.has(op));
        if (deferredOps.length > 0) {
          if (result.needsConfirmation) {
            setPendingOps(deferredOps);
          } else {
            const applied = applyGraphOps(graphData, deferredOps);
            setGraphData(applied.data);
            if (applied.clusterMode) {
              setClusterMode(applied.clusterMode);
            }
          }
        }
        return;
      }

      if (payload.type === "error") {
        graphTelemetry.recordChatError(payload.text ?? "The graph chat request failed.");
        setBusy(false);
        setStreamingText("");
        setAssistantText(payload.text ?? "The graph chat request failed.");
      }
    };

    nextSource.onerror = () => {
      setBackendStatus("unavailable");
      setBackendLabel("Lost connection to local Codex backend");
      nextSource.close();
    };
  }
}

function readStoredClusterMode(): GraphClusterMode {
  if (typeof window === "undefined") {
    return "eventType";
  }

  const storedValue = window.localStorage.getItem(CLUSTER_MODE_KEY);
  if (
    storedValue === "none" ||
    storedValue === "eventType" ||
    storedValue === "status" ||
    storedValue === "month" ||
    storedValue === "trainingBlock"
  ) {
    return storedValue;
  }

  return "eventType";
}

function readStoredAuthoredOnly() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(AUTHORED_ONLY_KEY) === "true";
}

function isImmediateGraphOp(op: GraphOp): op is Extract<GraphOp, { op: "focusNode" | "setClusterMode" | "fitView" }> {
  return op.op === "focusNode" || op.op === "setClusterMode" || op.op === "fitView";
}
