"use client";

/**
 * Diagnosi guasti AI su mobile — riusa la pagina /diagnostic esistente
 * dentro la shell /m, in un'area scrollabile dedicata.
 */

import DiagnosticPage from "../../diagnostic/page";

export default function MobileDiagnosiPage() {
  return (
    <div className="m-scroll" style={{ flex: 1, minHeight: 0, padding: "12px 14px 16px" }}>
      <DiagnosticPage />
    </div>
  );
}
