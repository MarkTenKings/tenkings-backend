/**
 * Placeholder label sheet generator.
 *
 * The final implementation will composite Ten Kings slab artwork, card/pack QR codes,
 * and item metadata into a printable PDF sized for the Zebra ZD621 (QR stickers)
 * and Primera LX910e (slab labels). Once the label template asset is committed,
 * replace this stub with a PDFKit/React-PDF routine that streams the document to S3/R2.
 */
export async function generateLabelSheetPdf(pairIds: string[]): Promise<never> {
  throw new Error(
    `Label sheet generation is not yet implemented. Received ${pairIds.length} pair(s). ` +
      "Add the Ten Kings slab label template and PDF layout before invoking this helper."
  );
}
