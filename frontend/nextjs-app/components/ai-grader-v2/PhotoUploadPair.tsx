import { useEffect, useState } from "react";
import type { SpeedsterCardSide } from "../../lib/ai-grader-v2/contracts";
import styles from "./PhotoUploadPair.module.css";

type PhotoUploadPairProps = {
  front: File | null;
  back: File | null;
  onChange: (side: SpeedsterCardSide, file: File) => void;
};

function PhotoSlot({
  side,
  file,
  onChange,
}: {
  side: SpeedsterCardSide;
  file: File | null;
  onChange: PhotoUploadPairProps["onChange"];
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
          <small>{file?.name}</small>
        </span>
      )}
    </label>
  );
}

export default function PhotoUploadPair({ front, back, onChange }: PhotoUploadPairProps) {
  const readyCount = Number(Boolean(front)) + Number(Boolean(back));

  return (
    <section className={styles.uploader} aria-label="Front and back card photos">
      <div className={styles.heading}>
        <div>
          <span>ORIGINAL CAPTURE</span>
          <h2>Front + back.</h2>
        </div>
        <p aria-live="polite"><strong>{readyCount}/2</strong> photos ready</p>
      </div>
      <div className={styles.pair}>
        <PhotoSlot side="FRONT" file={front} onChange={onChange} />
        <PhotoSlot side="BACK" file={back} onChange={onChange} />
      </div>
    </section>
  );
}
