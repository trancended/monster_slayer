/**
 * Spięcie z backendem (localhost.md §9). Trzy zasady:
 *  1. Pętla 60 Hz nigdy nie dotyka sieci.
 *  2. Balans: serwer → cache IndexedDB → dane wbudowane w bundle.
 *  3. Zatrzymanie Phoeniksa nie zatrzymuje gry — zmienia tylko status na offline.
 */
import { get, set } from "idb-keyval";
import { BalanceSchema, bundledBalance, bus, type Balance } from "@ms/core";
import type { SaveData } from "../save/save.ts";

export interface BackendStatus {
  online: boolean;
  source: "server" | "cache" | "bundled";
  etag: string | null;
}

export const status: BackendStatus = { online: false, source: "bundled", etag: null };

let deviceToken: string | null = null;
let sessionToken: string | null = null;

function ensureDeviceToken(): string {
  if (deviceToken) return deviceToken;
  const stored = localStorage.getItem("ms:device_token");
  if (stored) {
    deviceToken = stored;
  } else {
    deviceToken = crypto.randomUUID();
    localStorage.setItem("ms:device_token", deviceToken);
  }
  return deviceToken;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function loadBalance(): Promise<Balance> {
  const cached = await get<{ etag: string; data: unknown }>("balance");

  try {
    const res = await withTimeout(
      fetch("/api/balance", {
        headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
      }),
      2500,
    );

    if (res.status === 304 && cached) {
      setStatus(true, "cache", cached.etag);
      return BalanceSchema.parse(cached.data);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = (await res.json()) as { etag: string; data: unknown };
    const data = BalanceSchema.parse(body.data);
    await set("balance", { etag: body.etag, data: body.data });
    setStatus(true, "server", body.etag);
    return data;
  } catch {
    // Backend leży — gra i tak musi wystartować.
    if (cached) {
      try {
        const parsed = BalanceSchema.parse(cached.data);
        setStatus(false, "cache", cached.etag);
        return parsed;
      } catch {
        /* uszkodzony cache → schodzimy do bundla */
      }
    }
    setStatus(false, "bundled", null);
    return bundledBalance();
  }
}

function setStatus(online: boolean, source: BackendStatus["source"], etag: string | null): void {
  status.online = online;
  status.source = source;
  status.etag = etag;
  bus.emit("net:status", { online });
}

export async function openSession(): Promise<boolean> {
  try {
    const res = await withTimeout(
      fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_token: ensureDeviceToken() }),
      }),
      2500,
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: string };
    sessionToken = body.token ?? null;
    setStatus(true, status.source, status.etag);
    return true;
  } catch {
    setStatus(false, status.source, status.etag);
    return false;
  }
}

export async function syncSave(slot: number, data: SaveData): Promise<void> {
  if (!status.online) return;
  try {
    await withTimeout(
      fetch(`/api/saves/${slot}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ payload: data, save_version: data.save_version }),
      }),
      3000,
    );
  } catch {
    setStatus(false, status.source, status.etag);
  }
}

// ────────────────────────────────────────────────────────── telemetria

interface TelemetryEvent {
  type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

const queue: TelemetryEvent[] = [];
const MAX_QUEUE = 500;
const sessionId = crypto.randomUUID();
let optIn = false;
let flushTimer: number | null = null;

export function setTelemetryOptIn(value: boolean): void {
  optIn = value;
  if (!value) queue.length = 0;
}

export function recordEvent(type: string, payload: Record<string, unknown>): void {
  if (!optIn) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ type, payload, occurred_at: new Date().toISOString() });
  // Kontrakt: wysyłka co 5 s albo co 50 zdarzeń — zależnie co pierwsze.
  if (queue.length >= 50) void flushTelemetry();
}

export async function flushTelemetry(): Promise<void> {
  if (!optIn || queue.length === 0 || !status.online) return;
  const batch = queue.splice(0, queue.length);
  try {
    await withTimeout(
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, events: batch }),
      }),
      3000,
    );
  } catch {
    // Brak sieci → zdarzenia wracają do kolejki i pójdą przy powrocie.
    queue.unshift(...batch.slice(-MAX_QUEUE));
    setStatus(false, status.source, status.etag);
  }
}

export function startTelemetryLoop(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setInterval(() => void flushTelemetry(), 5000);
}

/** Hot reload balansu z kanału `balance:live` — bez przeładowania strony. */
export function connectBalanceLive(onUpdate: (balance: Balance) => void): void {
  if (!import.meta.env.DEV) return;
  // Bez backendu nie ma czego słuchać. Gra jest offline-first, więc brak
  // Phoeniksa nie może generować nieskończonej pętli reconnectów w konsoli.
  if (!status.online) return;

  const MAX_RETRIES = 3;
  let socket: WebSocket | null = null;
  let retry = 0;

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      socket = new WebSocket(`${proto}//${location.host}/socket/balance`);
    } catch {
      return;
    }
    socket.onmessage = (ev) => {
      try {
        const body = JSON.parse(ev.data as string) as { data: unknown; etag: string };
        const parsed = BalanceSchema.parse(body.data);
        status.etag = body.etag;
        onUpdate(parsed);
        bus.emit("balance:reloaded", { source: "balance:live" });
      } catch (err) {
        console.warn("[balance] odrzucono push", err);
      }
    };
    socket.onclose = () => {
      retry++;
      if (retry > MAX_RETRIES) return;
      setTimeout(connect, 1000 * retry);
    };
    socket.onerror = () => socket?.close();
  };
  connect();
}
