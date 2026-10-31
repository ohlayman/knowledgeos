export function parseCitations(text: string): number[] {
  return [...text.matchAll(/\[(\d{1,2})\]/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function uniqueCitationOrdinals(text: string): number[] {
  return [...new Set(parseCitations(text))];
}
