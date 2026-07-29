"use client";

/**
 * Livello i18n di MaintAI — italiano (default) / inglese.
 *
 * Scelta di design: **la stringa italiana è la chiave**. `t("Nuovo Ticket")`
 * restituisce l'italiano quando la lingua è `it` e cerca la traduzione nel
 * dizionario EN quando la lingua è `en`. Vantaggi in un'app già scritta
 * interamente in italiano:
 *  - nessuna chiave sintetica da inventare e mantenere allineata;
 *  - il codice resta leggibile (si legge la frase, non `tickets.new.title`);
 *  - degrado morbido: una stringa senza traduzione resta in italiano invece
 *    di mostrare una chiave rotta all'utente.
 *
 * Regole d'uso:
 *  - `t("testo")` per ogni testo mostrato all'utente (JSX, `title`, `placeholder`,
 *    `aria-label`, messaggi `notify.*`, opzioni di `<select>`).
 *  - `t("Ciao {nome}", { nome })` per l'interpolazione: mai concatenare stringhe
 *    tradotte, l'ordine delle parole cambia tra le lingue.
 *  - I **valori di dominio** che arrivano dal DB (stato/tipo/priorità ticket,
 *    ruoli, criticità) NON si traducono con `t`: si usano gli helper in
 *    `./domain`, che traducono solo l'etichetta mostrata lasciando intatto il
 *    valore inviato al backend.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { EN_DICTIONARY } from "./dictionary";

export type Locale = "it" | "en";

export const LOCALES: Locale[] = ["it", "en"];

export const LOCALE_STORAGE_KEY = "maintai_locale";

/** Tag BCP-47 usato per `Intl` / `toLocaleString` — vedi `useLocaleTag()`. */
export const LOCALE_TAGS: Record<Locale, string> = {
  it: "it-IT",
  en: "en-GB",
};

export const LOCALE_LABELS: Record<Locale, string> = {
  it: "Italiano",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return value === "it" || value === "en";
}

/**
 * Legge la lingua già risolta dallo script di bootstrap in `app/layout.tsx`
 * (attributo `lang` su `<html>`), così il primo render client coincide con
 * quello che l'utente vede senza flash di lingua sbagliata.
 */
export function readInitialLocale(): Locale {
  if (typeof document === "undefined") return "it";
  const fromDom = document.documentElement.getAttribute("lang");
  if (isLocale(fromDom)) return fromDom;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* localStorage non disponibile (Safari privato, iframe sandboxed) */
  }
  return "it";
}

/**
 * Lingua corrente leggibile **fuori da React**.
 *
 * Serve alle funzioni di formattazione dichiarate a livello di modulo
 * (`function formatDate(iso) { … }`), dove non si può chiamare un hook.
 *
 * È aggiornata da `setLocale` (gestore di evento) e inizializzata all'import
 * dallo stesso valore che legge il provider, quindi non c'è finestra in cui i
 * due divergano: quando un componente si ri-renderizza per il cambio lingua,
 * `getLocaleTag()` restituisce già il tag nuovo.
 *
 * Per il testo usare sempre `useT()`: questa è solo la scorciatoia per
 * `toLocaleDateString` / `Intl.NumberFormat`.
 */
let currentLocale: Locale = typeof document === "undefined" ? "it" : readInitialLocale();

export function getLocale(): Locale {
  return currentLocale;
}

/** Tag BCP-47 corrente, per `toLocaleDateString` / `Intl.*` fuori da React. */
export function getLocaleTag(): string {
  return LOCALE_TAGS[currentLocale];
}

export type TranslateVars = Record<string, string | number | null | undefined>;

/**
 * Sostituisce i segnaposto `{nome}` nella stringa.
 * Un segnaposto senza valore corrispondente resta invariato: è un errore
 * visibile in sviluppo, non un buco silenzioso nella UI.
 */
function interpolate(text: string, vars?: TranslateVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function translate(locale: Locale, source: string, vars?: TranslateVars): string {
  if (locale === "it") return interpolate(source, vars);
  return interpolate(EN_DICTIONARY[source] ?? source, vars);
}

/**
 * Traduttore **stabile**, da usare per i messaggi non renderizzati:
 * toast, `confirm()`, testo passato a librerie esterne.
 *
 * A differenza di `useT()` non è un valore reattivo, quindi non entra nelle
 * dipendenze di `useCallback`/`useEffect` e non fa rieseguire le fetch al
 * cambio lingua. Legge la lingua nell'istante in cui il messaggio viene
 * mostrato, che per un toast è esattamente il momento giusto.
 *
 * Per il testo che finisce nel JSX serve invece `useT()`: lì la reattività è
 * necessaria, altrimenti la schermata resterebbe nella lingua precedente.
 */
export function tn(source: string, vars?: TranslateVars): string {
  return translate(currentLocale, source, vars);
}

export type Translator = (source: string, vars?: TranslateVars) => string;

type I18nContextValue = {
  locale: Locale;
  localeTag: string;
  setLocale: (locale: Locale) => void;
  t: Translator;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "it",
  localeTag: LOCALE_TAGS.it,
  setLocale: () => {},
  t: (source, vars) => interpolate(source, vars),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  // Allinea le altre schede/finestre aperte sullo stesso browser.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      if (!isLocale(event.newValue)) return;
      currentLocale = event.newValue;
      setLocaleState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    currentLocale = next;
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* preferenza non persistita: la sessione corrente funziona comunque */
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    localeTag: LOCALE_TAGS[locale],
    setLocale,
    t: (source, vars) => translate(locale, source, vars),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Scorciatoia per il caso più frequente: serve solo la funzione di traduzione. */
export function useT(): Translator {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** Tag BCP-47 per `toLocaleDateString` / `Intl.NumberFormat`. */
export function useLocaleTag(): string {
  return useContext(I18nContext).localeTag;
}
