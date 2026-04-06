import { toast } from "sonner";
import { pushNotification, type NotificationType } from "./useNotifications";

/**
 * notify — Sistema di notifiche unificato per MaintAI.
 *
 * Ogni chiamata:
 * 1. Mostra un toast visuale temporaneo (Sonner)
 * 2. Salva la notifica nel pannello persistente (useNotifications store)
 *
 * Uso invariato rispetto alla versione precedente:
 *   notify.error("Errore caricamento ticket.");
 *   notify.success("Piano confermato!");
 *
 * Con source opzionale per il pannello:
 *   notify.success("Piano confermato!", "PLANNING");
 */

function emitNotification(
  type: NotificationType,
  msg: string,
  source?: string,
  toastDuration?: number,
) {
  // 1. Toast visuale
  const toastFn = type === "error"
    ? toast.error
    : type === "success"
    ? toast.success
    : type === "warning"
    ? toast.warning
    : toast.info;
  toastFn(msg, { duration: toastDuration });

  // 2. Notifica persistente
  pushNotification({ type, title: msg, source });
}

export const notify = {
  error:   (msg: string, source?: string) => emitNotification("error", msg, source, 5000),
  success: (msg: string, source?: string) => emitNotification("success", msg, source, 3000),
  info:    (msg: string, source?: string) => emitNotification("info", msg, source, 3000),
  warning: (msg: string, source?: string) => emitNotification("warning", msg, source, 4000),
};
