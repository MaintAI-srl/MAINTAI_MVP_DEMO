import { apiGetBlob } from "./api";

/**
 * Recupera il PDF del rapportino di un ticket e lo consegna all'utente.
 *
 * - `mode: "print"` (desktop): apre il PDF in una nuova scheda e lancia la
 *   stampa. Il client può poi salvarlo come PDF dal dialogo di stampa.
 * - `mode: "download"` (mobile): tenta la condivisione nativa (Web Share API,
 *   utile per inviare il PDF via WhatsApp/email al cliente); in fallback forza
 *   il download del file.
 */
export async function consegnaRapportino(
  ticketId: number,
  mode: "print" | "download",
): Promise<void> {
  const blob = await apiGetBlob(`/tickets/${ticketId}/rapportino.pdf`);
  const filename = `rapportino_ticket_${ticketId}.pdf`;

  if (mode === "download") {
    // Prova la condivisione nativa (mobile) con un vero File PDF
    const file = new File([blob], filename, { type: "application/pdf" });
    const navShare = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
    };
    if (navShare.share && navShare.canShare?.({ files: [file] })) {
      try {
        await navShare.share({
          files: [file],
          title: `Rapportino intervento #${ticketId}`,
          text: "Rapportino di intervento MaintAI",
        });
        return;
      } catch {
        // L'utente ha annullato la condivisione o non è supportata → fallback download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  // mode === "print" (desktop): apri in nuova scheda e stampa
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.addEventListener("load", () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* alcuni browser bloccano print() automatico: il PDF resta comunque aperto */
      }
    });
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
