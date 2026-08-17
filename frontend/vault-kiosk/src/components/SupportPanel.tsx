import { useEffect, useMemo, useState } from "react";
import type { KioskSaleSummary, KioskSupportConfig } from "../types";
import { createSupportUrl } from "../workflow/kioskWorkflow";

interface SupportPanelProps {
  support: KioskSupportConfig;
  sale: KioskSaleSummary;
}

export function SupportPanel({ support, sale }: SupportPanelProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const safeUrl = useMemo(
    () => createSupportUrl(support, sale.supportReference, sale.paidDoorIds),
    [support, sale.supportReference, sale.paidDoorIds],
  );

  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(safeUrl, {
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
  }, [safeUrl]);

  const subject = encodeURIComponent(`Vault support ${sale.supportReference}`);
  const body = encodeURIComponent(`Support reference: ${sale.supportReference}\nPaid doors: ${sale.paidDoorIds.join(", ")}`);
  const textBody = encodeURIComponent(`Vault ${sale.supportReference}; doors ${sale.paidDoorIds.join(", ")}`);

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
        <p className="paid-door-list"><b>Paid doors:</b> {sale.paidDoorIds.join(" · ")}</p>
        <p className="support-hours">Support hours: {support.hours}</p>
        <div className="support-actions" aria-label="Support contact choices">
          <a className="secondary-action" href={`mailto:${support.email}?subject=${subject}&body=${body}`}>Email</a>
          <a className="secondary-action" href={`sms:${support.textNumber}?body=${textBody}`}>Text message</a>
          <a className="secondary-action" href={`tel:${support.phoneNumber}`}>Phone call</a>
        </div>
      </div>
      <div className="support-qr">
        {qrDataUrl ? <img src={qrDataUrl} alt="QR code for the Ten Kings support page" /> : <div className="qr-placeholder" aria-label="Preparing support QR code" />}
        <span>Scan for support options</span>
      </div>
    </section>
  );
}
