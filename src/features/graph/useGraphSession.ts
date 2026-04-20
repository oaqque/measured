import { useEffect, useRef, useState } from "react";
import {
  appendLocalUserMessage,
  appendSystemMessage,
  applyGraphChatRpcEvent,
  type GraphChatEntry,
  type GraphChatRpcEvent,
} from "@/features/graph/chat-items";
import type { GraphClusterMode, NoteGraphData } from "@/lib/graph/schema";
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

interface SessionEventMessage {
  type: "status" | "rpcEvent" | "error";
  scope?: "connection" | "session";
  text?: string;
  method?: string;
  params?: Record<string, unknown>;
  requestId?: number | null;
}

const CLUSTER_MODE_KEY = "measured.noteGraph.clusterMode.v2";
const AUTHORED_ONLY_KEY = "measured.noteGraph.authoredOnly";

export function useGraphSession(initialGraphData: NoteGraphData) {
  const [chatEntries, setChatEntries] = useState<GraphChatEntry[]>([]);
  const [backendLabel, setBackendLabel] = useState("Checking local Codex backend...");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [clusterMode, setClusterMode] = useState<GraphClusterMode>(() => readStoredClusterMode());
  const [paused, setPaused] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showAuthoredOnly, setShowAuthoredOnly] = useState(readStoredAuthoredOnly());
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionReadyRef = useRef<Promise<void> | null>(null);
  const graphData = initialGraphData;

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
              ? "Codex backend connected"
              : "Codex backend needs authentication"
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
      eventSourceRef.current = null;
      sessionReadyRef.current = null;
      sessionIdRef.current = null;
    };
  }, []);

  const sendMessage = async (message: string) => {
    if (backendStatus !== "ready") {
      return;
    }

    const ensuredSessionId = await ensureSession();
    if (!ensuredSessionId) {
      return;
    }

    setBusy(true);
    setChatEntries((current) => appendLocalUserMessage(current, message));
    graphTelemetry.recordChatTurnStart();

    try {
      const response = await fetch(`/api/graph-chat/session/${ensuredSessionId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error(`Unable to send graph chat message (${response.status})`);
      }
    } catch (error) {
      graphTelemetry.recordChatError(error instanceof Error ? error.message : "The graph chat request failed.");
      setBusy(false);
      setChatEntries((current) =>
        appendSystemMessage(
          current,
          "Send failed",
          error instanceof Error ? error.message : "The graph chat request failed.",
          "failed",
        ),
      );
    }
  };

  const interrupt = async () => {
    if (!sessionId) {
      return;
    }

    await fetch(`/api/graph-chat/session/${sessionId}/interrupt`, {
      method: "POST",
    });
    setBusy(false);
    setChatEntries((current) => appendSystemMessage(current, "Turn interrupted", "Interrupted locally.", "interrupted"));
  };

  return {
    chatEntries,
    backendLabel,
    backendReady: backendStatus === "ready",
    busy,
    clusterMode,
    graphData,
    paused,
    setClusterMode,
    setPaused,
    setShowAuthoredOnly,
    showAuthoredOnly,
    interrupt,
    sendMessage,
  };

  async function ensureSession() {
    if (sessionIdRef.current) {
      if (sessionReadyRef.current) {
        try {
          await sessionReadyRef.current;
        } catch {
          return null;
        }
      }
      return sessionIdRef.current;
    }

    const response = await fetch("/api/graph-chat/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      setBackendStatus("unavailable");
      setBackendLabel(`Unable to create Codex chat session (${response.status})`);
      return null;
    }

    const payload = (await response.json()) as SessionResponse;
    sessionIdRef.current = payload.sessionId;
    setSessionId(payload.sessionId);
    sessionReadyRef.current = openEventSource(payload.sessionId);
    try {
      await sessionReadyRef.current;
    } catch {
      sessionIdRef.current = null;
      setSessionId(null);
      return null;
    }
    return payload.sessionId;
  }

  function openEventSource(nextSessionId: string) {
    eventSourceRef.current?.close();
    const nextSource = new EventSource(`/api/graph-chat/session/${nextSessionId}/events`);
    eventSourceRef.current = nextSource;
    let opened = false;
    const ready = new Promise<void>((resolve, reject) => {
      nextSource.onopen = () => {
        opened = true;
        resolve();
      };
      nextSource.onerror = () => {
        setBackendStatus("unavailable");
        setBackendLabel("Lost connection to local Codex backend");
        setBusy(false);
        setChatEntries((current) =>
          appendSystemMessage(current, "Connection lost", "Lost connection to local Codex backend.", "failed"),
        );
        nextSource.close();
        eventSourceRef.current = null;
        sessionIdRef.current = null;
        sessionReadyRef.current = null;
        if (!opened) {
          reject(new Error("Unable to connect to Codex chat event stream."));
        }
      };
    });
    nextSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as SessionEventMessage;

      if (payload.type === "status") {
        if (payload.text && payload.scope !== "connection") {
          setBackendLabel(payload.text);
        }
        return;
      }

      if (payload.type === "rpcEvent" && payload.method && payload.params) {
        const nextEvent: GraphChatRpcEvent = {
          method: payload.method,
          params: payload.params,
          requestId: payload.requestId ?? null,
        };
        setChatEntries((current) => applyGraphChatRpcEvent(current, nextEvent));
        if (payload.method === "turn/completed") {
          const turn = payload.params.turn;
          const status =
            typeof turn === "object" &&
            turn !== null &&
            "status" in turn &&
            typeof turn.status === "string"
              ? turn.status
              : null;
          setBusy(false);
          if (status === "completed") {
            graphTelemetry.recordChatTurnComplete();
          } else if (status === "failed") {
            graphTelemetry.recordChatError("The Codex chat turn failed.");
          }
        }
        return;
      }

      if (payload.type === "error") {
        graphTelemetry.recordChatError(payload.text ?? "The graph chat request failed.");
        setBusy(false);
        setChatEntries((current) =>
          appendSystemMessage(current, "Chat error", payload.text ?? "The graph chat request failed.", "failed"),
        );
      }
    };
    return ready;
  }
}

function readStoredClusterMode(): GraphClusterMode {
  if (typeof window === "undefined") {
    return "none";
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

  return "none";
}

function readStoredAuthoredOnly() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(AUTHORED_ONLY_KEY) === "true";
}
