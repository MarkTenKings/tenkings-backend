const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTkd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) {
    return "–";
  }
  return `${currencyFormatter.format(amount / 100)} TKD`;
}

export function formatUsdMinor(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) {
    return "–";
  }
  return `$${currencyFormatter.format(amount / 100)}`;
}
