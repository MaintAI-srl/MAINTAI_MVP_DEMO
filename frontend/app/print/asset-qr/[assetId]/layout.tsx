// Layout isolato per la pagina di stampa QR — esclude navbar/sidebar globali
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Stampa QR Asset</title>
        <style>{`
          @media print {
            @page { margin: 0; size: A4; }
            body { margin: 0; }
          }
          * { box-sizing: border-box; }
        `}</style>
      </head>
      <body style={{ margin: 0, padding: 0, background: "#ffffff", fontFamily: "sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
