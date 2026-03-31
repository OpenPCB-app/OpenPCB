import { useState, useEffect, useRef } from "react";
import type { PageUpdateEvent } from "../../shared/types";
import { getBackendURL } from "../../../../src-ts/shared/sdk/mutator";

/**
 * Hook to subscribe to Knowledge page update events via SSE.
 * 
 * @param workspaceId The active workspace ID to filter events for.
 * @param onPageUpdate Callback called when a page update event is received.
 * @param onReconnectAfterOutage Callback called when SSE reconnects after a prolonged outage (>60s).
 */
export function useKnowledgePageUpdates(
  workspaceId: string | null,
  onPageUpdate: (event: PageUpdateEvent) => void,
  onReconnectAfterOutage?: () => void
): { isConnected: boolean } {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef<number>(1000);
  const onPageUpdateRef = useRef(onPageUpdate);
  const onReconnectAfterOutageRef = useRef(onReconnectAfterOutage);
  const hasLoggedErrorRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const disconnectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    onPageUpdateRef.current = onPageUpdate;
  }, [onPageUpdate]);

  useEffect(() => {
    onReconnectAfterOutageRef.current = onReconnectAfterOutage;
  }, [onReconnectAfterOutage]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const connect = () => {
      const backendUrl = getBackendURL();
      if (!backendUrl) {
        console.warn("[Knowledge SSE] Backend URL not available, retrying in 2s...");
        reconnectTimerRef.current = setTimeout(connect, 2000);
        return;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const url = `${backendUrl.replace(/\/$/, "")}/api/modules/knowledge/events/pages?workspace_id=${workspaceId}`;
      console.debug("[Knowledge SSE] Connecting to:", url);

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.debug("[Knowledge SSE] Connected");
        setIsConnected(true);
        hasLoggedErrorRef.current = false;
        reconnectDelayRef.current = 1000;

        if (disconnectedAtRef.current !== null) {
          const duration = Date.now() - disconnectedAtRef.current;
          if (duration > 60000) {
            console.debug(`[Knowledge SSE] Reconnected after prolonged outage (${Math.round(duration / 1000)}s)`);
            onReconnectAfterOutageRef.current?.();
          }
          disconnectedAtRef.current = null;
        }
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.event === "ping") {
            return;
          }

          if (data.type && data.pageId && data.workspaceId) {
            onPageUpdateRef.current(data as PageUpdateEvent);
          } else {
            console.warn("[Knowledge SSE] Received invalid event data:", data);
          }
        } catch (err) {
          console.error("[Knowledge SSE] Failed to parse event data:", err);
        }
      };

      es.onerror = (err) => {
        if (!hasLoggedErrorRef.current) {
          console.error("[Knowledge SSE] Connection error:", err);
          hasLoggedErrorRef.current = true;
        } else {
          console.debug("[Knowledge SSE] Connection still unavailable");
        }
        setIsConnected(false);
        if (disconnectedAtRef.current === null) {
          disconnectedAtRef.current = Date.now();
        }
        es.close();
        eventSourceRef.current = null;

        const delay = reconnectDelayRef.current;
        console.debug(`[Knowledge SSE] Reconnecting in ${delay}ms...`);
        reconnectTimerRef.current = setTimeout(connect, delay);
        
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [workspaceId]);

  return { isConnected };
}
