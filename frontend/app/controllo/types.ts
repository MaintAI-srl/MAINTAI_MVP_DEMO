// Tipi condivisi della pagina Centro di Controllo (/controllo)

export type SitoStatus = "critico" | "attenzione" | "ok";

export type SitoOverview = {
  sito_id: number;
  nome: string;
  citta: string | null;
  indirizzo: string;
  responsabile: string | null;
  lat: number | null;
  lon: number | null;
  posizione_fonte: "impianti" | "geocoding" | null;
  n_impianti: number;
  n_asset: number;
  asset_stati: { service: number; stopped: number; out_of_service: number };
  ticket: { aperti: number; in_corso: number; pianificati: number; bd_attivi: number };
  status: SitoStatus;
};

export type ImpiantoMarker = {
  impianto_id: number;
  nome: string;
  sito_id: number | null;
  lat: number;
  lon: number;
  n_asset: number;
  asset_guasti: number;
};

export type ControlCenterSummary = {
  n_siti: number;
  siti_critici: number;
  assets: number;
  asset_stati: { service: number; stopped: number; out_of_service: number };
  ticket_aperti: number;
  ticket_in_corso: number;
  ticket_pianificati: number;
  bd_attivi: number;
  tecnici: number;
  tecnici_disponibili: number;
};

export type ControlCenterData = {
  siti: SitoOverview[];
  impianti: ImpiantoMarker[];
  summary: ControlCenterSummary;
};

export const STATUS_COLORS: Record<SitoStatus, string> = {
  critico: "#ef4444",
  attenzione: "#f59e0b",
  ok: "#22c55e",
};

export const STATUS_LABELS: Record<SitoStatus, string> = {
  critico: "Critico",
  attenzione: "Attenzione",
  ok: "Operativo",
};
