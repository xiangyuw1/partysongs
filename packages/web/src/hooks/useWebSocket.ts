import { useEffect, useRef, useCallback, useState } from 'react';

type WsHandler = (msg: { type: string; data: unknown }) => void;

const HEARTBEAT_INTERVAL = 15000; // 15 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds to wait for pong

export function useWebSocket(onMessage: WsHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongRef = useRef<number>(Date.now());

  onMessageRef.current = onMessage;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimerRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
          // Set timeout for pong response
          pongTimeoutRef.current = setTimeout(() => {
            // If no pong received within timeout, connection might be dead
            if (Date.now() - lastPongRef.current > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
              console.warn('[WS] Heartbeat timeout, reconnecting...');
              wsRef.current?.close();
            }
          }, HEARTBEAT_TIMEOUT);
        }
      }, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (pongTimeoutRef.current) {
        clearTimeout(pongTimeoutRef.current);
        pongTimeoutRef.current = null;
      }
    }

    function connect() {
      if (closed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) { ws.close(); return; }
        setConnected(true);
        lastPongRef.current = Date.now();
        startHeartbeat();
      };
      ws.onclose = () => {
        setConnected(false);
        stopHeartbeat();
        if (!closed) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Handle pong response
          if (msg.type === 'pong') {
            lastPongRef.current = Date.now();
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            return;
          }
          onMessageRef.current(msg);
        } catch {}
      };
    }

    connect();
    return () => {
      closed = true;
      stopHeartbeat();
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
