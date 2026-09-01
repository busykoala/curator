function rawValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).map(String);
}

function clean(value: string): string {
  return value.normalize("NFC").replace(/[\u200e\u200f\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

function validPerson(value: string): boolean {
  const compact = value.replace(/[\s._()-]+/g, " ").trim();
  if (!value || !/\p{L}/u.test(value) || /[<>]{3,}|[*¤]{3,}/u.test(value)) return false;
  if (/^(?:unknown|undefined|null|n a|see subsong|various artists?|vari+ous|va|traditional|associated ?performer|featured ?artist|main ?artist|composer ?lyricist|producer|recording arranger|bass vocal|double bass|drums?|guitars?|percussion|piano|tenor saxophone|vocals?|jr|sr|i{2,4})$/i.test(compact)) return false;
  if (/\b(?:records?|music group|catalog(?:ue)?|label)\b/i.test(value) && /\d{3,}/.test(value)) return false;
  if ((value.match(/\d/g) ?? []).length > 4 || value.length > 100) return false;
  return true;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitComposer(value: string): string[] {
  const protectedSuffix = value.replace(/,\s*(Jr\.|Sr\.|II|III|IV)$/i, "@@SUFFIX@@$1");
  return protectedSuffix
    .split(/\s*(?:;|\||\/|\s+-\s+|,|\s+&\s+|\s+and\s+)\s*/i)
    .map((part) => part.replace("@@SUFFIX@@", ", "));
}

export function splitComposerCredits(value: unknown): string[] {
  return unique(rawValues(value).flatMap(splitComposer).map(clean).filter(validPerson));
}

export function splitArtistCredits(value: unknown): string[] {
  return unique(rawValues(value)
    .flatMap((item) => item.split(/\s*(?:;|\||feat\.|ft\.|\s+(?:feat|ft|featuring)\s+)\s*/i))
    .map(clean).filter(validPerson));
}
