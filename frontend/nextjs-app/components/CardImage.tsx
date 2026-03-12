import Image, { type ImageProps } from "next/image";

type CardImageProps = Omit<ImageProps, "src"> & {
  cdnHdUrl?: string | null;
  cdnThumbUrl?: string | null;
  fallbackUrl?: string | null;
  variant: "thumb" | "hd";
};

export function CardImage({
  cdnHdUrl,
  cdnThumbUrl,
  fallbackUrl,
  variant,
  alt,
  ...imageProps
}: CardImageProps) {
  const src =
    variant === "hd"
      ? cdnHdUrl ?? cdnThumbUrl ?? fallbackUrl ?? ""
      : cdnThumbUrl ?? cdnHdUrl ?? fallbackUrl ?? "";

  if (!src) {
    return (
      <div
        style={{
          width: imageProps.width ?? "100%",
          height: imageProps.height ?? "100%",
          backgroundColor: "#1a1a2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#555",
          fontSize: "0.75rem",
        }}
      >
        No image
      </div>
    );
  }

  return <Image src={src} alt={alt} unoptimized {...imageProps} />;
}
