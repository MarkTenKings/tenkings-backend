import Image from "next/image";
import { useEffect, useState } from "react";
import type { SpeedsterCardSide } from "../../lib/ai-grader-v2/contracts";

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
    <label className={preview ? "photo-slot has-photo" : "photo-slot"}>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onChange(side, next);
        }}
      />
      {preview ? (
        <Image
          src={preview}
          alt={`${side.toLowerCase()} card preview`}
          fill
          unoptimized
          sizes="(max-width: 760px) 100vw, 50vw"
        />
      ) : null}
      <span className="side">{side}</span>
      <strong>{file ? "Replace photo" : `Add ${side.toLowerCase()} photo`}</strong>
      <small>{file?.name ?? "One clear original image"}</small>
    </label>
  );
}

export default function PhotoUploadPair({ front, back, onChange }: PhotoUploadPairProps) {
  return (
    <div className="photo-pair">
      <PhotoSlot side="FRONT" file={front} onChange={onChange} />
      <PhotoSlot side="BACK" file={back} onChange={onChange} />
      <style jsx>{`
        .photo-pair {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }
        .photo-slot {
          position: relative;
          min-height: 430px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 10px;
          overflow: hidden;
          border: 1px solid #5b4923;
          border-radius: 20px;
          background: linear-gradient(145deg, #0d0d0c, #070706);
          color: #f6f1e7;
          cursor: pointer;
        }
        .photo-slot:hover { border-color: #d5ad4a; }
        input { position: absolute; width: 1px; height: 1px; opacity: 0; }
        img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #050505; }
        .side, strong, small { position: relative; z-index: 1; }
        .side { color: #d5ad4a; font-size: 11px; font-weight: 800; letter-spacing: 0.26em; }
        strong { font-size: 20px; }
        small { color: #8f8a80; }
        .has-photo strong, .has-photo small {
          align-self: end;
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.78);
        }
        .has-photo .side { position: absolute; top: 16px; left: 16px; padding: 7px 10px; background: #0a0906; }
        .has-photo strong { position: absolute; right: 16px; bottom: 16px; font-size: 13px; }
        .has-photo small { display: none; }
        @media (max-width: 760px) {
          .photo-pair { grid-template-columns: 1fr; }
          .photo-slot { min-height: 360px; }
        }
      `}</style>
    </div>
  );
}
