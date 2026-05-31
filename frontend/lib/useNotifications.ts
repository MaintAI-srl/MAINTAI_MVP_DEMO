/**
 * useNotifications — Store centralizzato per notifiche in-app persistenti.
 *
 * Estende il sistema `notify` (toast via Sonner) con un pannello persistente
 * che raccoglie tutte le notifiche della sessione corrente. Le notifiche
 * restano visibili nel pannello campanella anche dopo che il toast è scomparso.
 *
 * Uso:
 *   import { useNotifications, pushNotification } from "@/lib/useNotifications";
 *
 *   // Da qualsiasi parte dell'app:
 *   pushNotification({ type: "success", title: "Piano confermato", message: "PIANO-005 attivo" });
 *
 *   // Nel componente NotificationPanel:
 *   const { notifications, unreadCount, markAllRead, clear } = useNotifications();
 */
import { useSyncExternalStore, useCallback } from "react";

// ── Tipi ─────────────────────────────────────────────────────────────────────
export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
  /** Modulo di origine (es. "PLANNING", "TICKET", "SYSTEM") */
  source?: string;
}

// ── Store in-memoria ─────────────────────────────────────────────────────────
let _notifications: AppNotification[] = [];
const _listeners: Set<() => void> = new Set();
const MAX_NOTIFICATIONS = 100;

function _emit() {
  for (const fn of _listeners) fn();
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function _getSnapshot(): AppNotification[] {
  return _notifications;
}

// ── API pubblica ─────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Aggiunge una notifica al pannello persistente.
 * Può essere chiamata da qualsiasi punto dell'app (non serve un hook).
 */
export function pushNotification(opts: {
  type: NotificationType;
  title: string;
  message?: string;
  source?: string;
}): void {
  const notification: AppNotification = {
    id: `n_${Date.now()}_${++_idCounter}`,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    timestamp: Date.now(),
    read: false,
    source: opts.source,
  };

  _notifications = [notification, ..._notifications].slice(0, MAX_NOTIFICATIONS);
  _emit();
}

/**
 * Segna tutte le notifiche come lette.
 */
export function markAllNotificationsRead(): void {
  _notifications = _notifications.map(n => ({ ...n, read: true }));
  _emit();
}

/**
 * Cancella tutte le notifiche.
 */
export function clearNotifications(): void {
  _notifications = [];
  _emit();
}

// ── Hook React ───────────────────────────────────────────────────────────────

export function useNotifications() {
  const notifications = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = useCallback(() => markAllNotificationsRead(), []);
  const clear = useCallback(() => clearNotifications(), []);

  return {
    notifications,
    unreadCount,
    markAllRead,
    clear,
  };
}
