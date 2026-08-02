import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { SpeedsterCardSide } from "../../lib/ai-grader-v2/contracts";
import styles from "./PhotoUploadPair.module.css";

export type SpeedsterOriginalPhoto =
  | { kind: "LOCAL"; file: File }
  | {
    kind: "IPHONE";
    storageKey: string;
    readUrl: string;
    captureVersion: number;
  };

type PhotoUploadPairProps = {
  front: SpeedsterOriginalPhoto | null;
  back: SpeedsterOriginalPhoto | null;
  pairingUrl?: string;
  onChange: (side: SpeedsterCardSide, file: File) => void;
  onSwap: () => void;
};

function PhotoSlot({
  side,
  photo,
  onChange,
}: {
  side: SpeedsterCardSide;
  photo: SpeedsterOriginalPhoto | null;
  onChange: PhotoUploadPairProps["onChange"];
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    if (photo.kind === "IPHONE") {
      setPreview(photo.readUrl);
      return;
    }
    const url = URL.createObjectURL(photo.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  return (
    <label className={styles.slot}>
      <input
        className={styles.input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onChange(side, next);
        }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.preview}
          src={preview}
          alt={`${side.toLowerCase()} card preview`}
          draggable={false}
        />
      ) : null}
      <span className={styles.side}>{side}</span>
      {!preview ? (
        <span className={styles.emptyState}>
          <span className={styles.uploadMark} aria-hidden="true">+</span>
          <strong>Add {side.toLowerCase()} photo</strong>
          <small>JPEG, PNG or WebP</small>
        </span>
      ) : (
        <span className={styles.photoAction}>
          <strong>Replace photo</strong>
          <small>{photo?.kind === "LOCAL" ? photo.file.name : "iPhone capture"}</small>
        </span>
      )}
    </label>
  );
}

function PairingQr({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, value, {
      width: 92,
      margin: 1,
      color: { dark: "#080806", light: "#f3d58a" },
    });
  }, [value]);

  return <canvas ref={canvasRef} className={styles.qr} aria-label="Pair iPhone QR code" />;
}

export default function PhotoUploadPair({
  front,
  back,
  pairingUrl,
  onChange,
  onSwap,
}: PhotoUploadPairProps) {
  const readyCount = Number(Boolean(front)) + Number(Boolean(back));

  return (
    <section className={styles.uploader} aria-label="Front and back card photos">
      <div className={styles.heading}>
        <div>
          <span>ORIGINAL CAPTURE</span>
          <h2>Front + back.</h2>
        </div>
        <div className={styles.headingActions}>
          <p aria-live="polite"><strong>{readyCount}/2</strong> photos ready</p>
          {readyCount === 2 ? <button type="button" onClick={onSwap}>Swap front / back</button> : null}
        </div>
      </div>
      {pairingUrl ? (
        <div className={styles.iphoneBar}>
          <PairingQr value={pairingUrl} />
          <div>
            <span>PAIR IPHONE ONCE</span>
            <strong>Scan, then run the Speedster Shortcut after taking front + back.</strong>
          </div>
        </div>
      ) : null}
      <div className={styles.pair}>
        <PhotoSlot side="FRONT" photo={front} onChange={onChange} />
        <PhotoSlot side="BACK" photo={back} onChange={onChange} />
      </div>
    </section>
  );
}
