import { useEffect, useMemo, useState } from "react";
import type { KioskSaleSummary, KioskSupportConfig } from "../types";
import { createSupportUrl, saleDoorLabel } from "../workflow/kioskWorkflow";

interface SupportPanelProps {
  support: KioskSupportConfig;
  sale: KioskSaleSummary;
}

export function SupportPanel({ support, sale }: SupportPanelProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<{ url: string; label: string } | null>(null);
  const paymentUnknown = ["UNKNOWN", "RECONCILIATION_REQUIRED", "REQUESTED"].includes(sale.paymentState);
  const contextDoorIds = useMemo(() => paymentUnknown ? sale.items.map((item) => item.doorId) : sale.paidDoorIds, [paymentUnknown, sale.items, sale.paidDoorIds]);
  const safeUrl = useMemo(
    () => createSupportUrl(support, sale.supportReference, contextDoorIds),
    [support, sale.supportReference, contextDoorIds],
  );
  const qrUrl = selectedContact?.url ?? safeUrl;
  useEffect(() => { setSelectedContact(null); }, [safeUrl]);

  useEffect(() => {
    let active = true;
    setQrDataUrl(null);
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 220,
        color: { dark: "#080706", light: "#fff8df" },
      }))
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => { active = false; };
  }, [qrUrl]);

  const subject = encodeURIComponent(`Vault support ${sale.supportReference}`);
  const doorLabel = paymentUnknown ? "Reserved doors (payment unresolved)" : "Paid doors";
  const labels = contextDoorIds.map((doorId) => saleDoorLabel(sale, doorId));
  const body = encodeURIComponent(`Support reference: ${sale.supportReference}\n${doorLabel}: ${labels.join(", ")}`);
  const textBody = encodeURIComponent(`Vault ${sale.supportReference}; ${doorLabel}: ${labels.join(", ")}`);

  return (
    <section className="support-panel" aria-labelledby="support-title">
      <div className="support-copy">
        <p className="eyebrow">Human support</p>
        <h2 id="support-title">Contact Ten Kings</h2>
        <p>Use this short reference. It contains no payment-provider ID or personal information.</p>
        <div className="support-reference">
          <span>Reference</span>
          <strong>{sale.supportReference}</strong>
        </div>
        {paymentUnknown && <p className="inline-alert">Checking payment — do not pay again.</p>}
        <p className="paid-door-list"><b>{paymentUnknown ? "Reserved doors:" : "Paid doors:"}</b> {labels.join(" · ")}</p>
        <p className="support-hours">Support hours: {support.hours}</p>
        <div className="support-actions" aria-label="Support contact choices">
          <a className="secondary-action" href={`mailto:${support.email}?subject=${subject}&body=${body}`} onClick={(event) => { event.preventDefault(); setSelectedContact({ url: event.currentTarget.href, label: "email Ten Kings" }); }}>Email <small>{support.email}</small></a>
          <a className="secondary-action" href={`sms:${support.textNumber}?body=${textBody}`} onClick={(event) => { event.preventDefault(); setSelectedContact({ url: event.currentTarget.href, label: "text Ten Kings" }); }}>Text message <small>{support.textNumber}</small></a>
          <a className="secondary-action" href={`tel:${support.phoneNumber}`} onClick={(event) => { event.preventDefault(); setSelectedContact({ url: event.currentTarget.href, label: "call Ten Kings" }); }}>Phone call <small>{support.phoneNumber}</small></a>
        </div>
      </div>
      <div className="support-qr">
        {qrDataUrl ? <img src={qrDataUrl} alt={`QR code to ${selectedContact?.label ?? "open the Ten Kings support page"}`} /> : <div className="qr-placeholder" aria-label="Preparing support QR code" />}
        <span aria-live="polite">Scan to {selectedContact?.label ?? "open support options"}</span>
        <a href={safeUrl} onClick={(event) => { event.preventDefault(); setSelectedContact(null); }} className="support-page-link">Ten Kings support page</a>
        <p>Scan with your phone to email, text, or call. You can also use the contacts shown here.</p>
      </div>
    </section>
  );
}
