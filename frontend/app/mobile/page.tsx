import { redirect } from "next/navigation";

/**
 * La vecchia app tecnico /mobile è stata sostituita dalla sezione mobile /m
 * (shell dedicata con bottom tab bar). Redirect permanente per compatibilità
 * con segnalibri, shortcut PWA e notifiche push già installate.
 */
export default function MobileRedirect() {
  redirect("/m");
}
