"use client";

/**
 * Traduzione dei **valori di dominio** (stati, tipi, priorità, ruoli…).
 *
 * Questi valori vivono nel database in italiano e devono restarci: il backend
 * confronta `stato == "Pianificato"`, il planner filtra per `tipo == "PM"`, le
 * query multi-tenant si appoggiano a queste stringhe. Qui si traduce **solo
 * l'etichetta mostrata**; il valore inviato alle API resta invariato.
 *
 * Pattern d'uso in un `<select>`:
 *   <option value={stato}>{statoTicketLabel(stato, locale)}</option>
 * il `value` resta italiano, l'utente legge l'inglese.
 *
 * La terminologia inglese segue il lessico CMMS/EN 13306 (Breakdown,
 * Preventive/Corrective Maintenance, Work Order, Downtime), non la traduzione
 * letterale: "Fermo" è *Down*, non *Stop*; "Scadenziario" è *Due Schedule*,
 * non *Deadline book*.
 */

import { getLocale, type Locale } from "./index";

type LabelMap = Record<string, string>;

/** Confronto tollerante: i valori in DB non sono normalizzati per maiuscole. */
function lookup(map: LabelMap, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return map[value] ?? map[value.toLowerCase()] ?? map[value.trim()] ?? map[value.trim().toLowerCase()];
}

function makeLabeller(map: LabelMap) {
  return (value: string | null | undefined, locale: Locale): string => {
    if (value === null || value === undefined || value === "") return "";
    if (locale === "it") return value;
    return lookup(map, value) ?? value;
  };
}

// ── Ticket ─────────────────────────────────────────────────────────────────

const STATO_TICKET_EN: LabelMap = {
  "Aperto": "Open",
  "Pianificato": "Scheduled",
  "In corso": "In Progress",
  "Chiuso": "Closed",
  "Eliminato": "Deleted",
  "Sospeso": "On Hold",
  "In attesa": "Pending",
  "Annullato": "Cancelled",
};

/**
 * Tipi di intervento. Le sigle (BD/PM/CM/ISP/MOD-STR) sono già acronimi
 * inglesi e restano invariate: si traduce solo la forma estesa.
 */
const TIPO_TICKET_EN: LabelMap = {
  "BD": "BD",
  "PM": "PM",
  "CM": "CM",
  "ISP": "ISP",
  "MOD-STR": "MOD-STR",
};

const TIPO_TICKET_ESTESO_EN: LabelMap = {
  "BD": "Breakdown",
  "PM": "Preventive Maintenance",
  "CM": "Corrective Maintenance",
  "ISP": "Inspection",
  "MOD-STR": "Modification / Structural Work",
};

const TIPO_TICKET_ESTESO_IT: LabelMap = {
  "BD": "Guasto",
  "PM": "Manutenzione Preventiva",
  "CM": "Manutenzione Correttiva",
  "ISP": "Ispezione",
  "MOD-STR": "Modifica / Opera Strutturale",
};

const PRIORITA_EN: LabelMap = {
  "Emergenza": "Emergency",
  "Critica": "Critical",
  "Alta": "High",
  "Media": "Medium",
  "Bassa": "Low",
  "Nessuna": "None",
};

// ── Asset e impianti ───────────────────────────────────────────────────────

const STATO_ASSET_EN: LabelMap = {
  "attivo": "Running",
  "Attivo": "Running",
  "in servizio": "In Service",
  "In servizio": "In Service",
  "active": "Running",
  "service": "In Service",
  "Fermo": "Down",
  "fermo": "Down",
  "stopped": "Down",
  "Manutenzione": "Under Maintenance",
  "manutenzione": "Under Maintenance",
  "In manutenzione": "Under Maintenance",
  "out of service": "Out of Service",
  "Fuori servizio": "Out of Service",
  "Dismesso": "Decommissioned",
  "dismesso": "Decommissioned",
  "Guasto": "Faulty",
};

const CRITICITA_EN: LabelMap = {
  "Alta": "High",
  "Media": "Medium",
  "Bassa": "Low",
  "Critica": "Critical",
};

// ── Personale ──────────────────────────────────────────────────────────────

const STATO_TECNICO_EN: LabelMap = {
  "in servizio": "On Duty",
  "ferie": "On Leave",
  "malattia": "Sick Leave",
  "corso": "Training",
  "trasferta": "On Assignment",
  "permesso": "Time Off",
};

const TIPO_ASSENZA_EN: LabelMap = {
  "Ferie": "Annual Leave",
  "Malattia": "Sick Leave",
  "Permesso": "Time Off",
  "Formazione": "Training",
  "Trasferta": "Business Trip",
  "Altro": "Other",
};

const RUOLO_EN: LabelMap = {
  "superadmin": "Superadmin",
  "responsabile": "Manager",
  "tecnico": "Technician",
  "admin": "Admin",
  "operatore": "Operator",
  "visualizzatore": "Viewer",
};

const COMPETENZA_EN: LabelMap = {
  "Meccanico": "Mechanical",
  "Elettricista": "Electrical",
  "Elettrico": "Electrical",
  "Idraulico": "Hydraulic",
  "Strumentista": "Instrumentation",
  "Automazione": "Automation",
  "Saldatore": "Welding",
  "Generico": "General",
  "Oleodinamico": "Hydraulic Power",
  "Pneumatico": "Pneumatic",
  "Frigorista": "Refrigeration",
  "Termotecnico": "HVAC",
};

// ── API pubblica ───────────────────────────────────────────────────────────

export const statoTicketLabel = makeLabeller(STATO_TICKET_EN);
export const tipoTicketLabel = makeLabeller(TIPO_TICKET_EN);
export const prioritaLabel = makeLabeller(PRIORITA_EN);
export const statoAssetLabel = makeLabeller(STATO_ASSET_EN);
export const criticitaLabel = makeLabeller(CRITICITA_EN);
export const statoTecnicoLabel = makeLabeller(STATO_TECNICO_EN);
export const tipoAssenzaLabel = makeLabeller(TIPO_ASSENZA_EN);
export const ruoloLabel = makeLabeller(RUOLO_EN);
export const competenzaLabel = makeLabeller(COMPETENZA_EN);

/** Forma estesa del tipo intervento, per legende e tooltip. */
export function tipoTicketEsteso(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  const map = locale === "en" ? TIPO_TICKET_ESTESO_EN : TIPO_TICKET_ESTESO_IT;
  return lookup(map, value) ?? value;
}

// ── Scorciatoie senza `locale` esplicito ───────────────────────────────────
// Leggono la lingua corrente da `getLocale()`. Usarle dentro il JSX, dove
// passare `locale` a ogni badge renderebbe il markup illeggibile; il
// componente si ri-renderizza comunque al cambio lingua perché consuma il
// contesto i18n tramite `t`.

/**
 * Stato di un ticket **o** di un asset: i due vocabolari non si sovrappongono
 * (Aperto/Pianificato/… contro attivo/fermo/out of service), quindi un unico
 * helper evita di dover distinguere il tipo di record in ogni punto d'uso.
 */
export function labelStato(value: string | null | undefined): string {
  const locale = getLocale();
  if (!value || locale === "it") return value ?? "";
  return lookup(STATO_TICKET_EN, value) ?? lookup(STATO_ASSET_EN, value) ?? value;
}

export function labelPriorita(value: string | null | undefined): string {
  return prioritaLabel(value, getLocale());
}

export function labelCriticita(value: string | null | undefined): string {
  return criticitaLabel(value, getLocale());
}

export function labelStatoTecnico(value: string | null | undefined): string {
  return statoTecnicoLabel(value, getLocale());
}

export function labelTipoAssenza(value: string | null | undefined): string {
  return tipoAssenzaLabel(value, getLocale());
}

export function labelRuolo(value: string | null | undefined): string {
  return ruoloLabel(value, getLocale());
}

export function labelCompetenza(value: string | null | undefined): string {
  return competenzaLabel(value, getLocale());
}

/**
 * Hook di comodo: restituisce tutti i labeller già legati alla lingua attiva,
 * per evitare di passare `locale` a ogni chiamata dentro il JSX.
 */
export function makeDomainLabels(locale: Locale) {
  return {
    stato: (v: string | null | undefined) => statoTicketLabel(v, locale),
    tipo: (v: string | null | undefined) => tipoTicketLabel(v, locale),
    tipoEsteso: (v: string | null | undefined) => tipoTicketEsteso(v, locale),
    priorita: (v: string | null | undefined) => prioritaLabel(v, locale),
    statoAsset: (v: string | null | undefined) => statoAssetLabel(v, locale),
    criticita: (v: string | null | undefined) => criticitaLabel(v, locale),
    statoTecnico: (v: string | null | undefined) => statoTecnicoLabel(v, locale),
    tipoAssenza: (v: string | null | undefined) => tipoAssenzaLabel(v, locale),
    ruolo: (v: string | null | undefined) => ruoloLabel(v, locale),
    competenza: (v: string | null | undefined) => competenzaLabel(v, locale),
  };
}
