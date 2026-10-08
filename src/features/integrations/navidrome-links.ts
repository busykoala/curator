// Navidrome's Jellyfin API uses 128-bit hex GUIDs, while newer web clients
// use zero-padded base62 IDs (model/id/id.go). Older clients retain hex IDs.
export function nativeIdFromJellyfin(value: string) {
  if (!/^[a-f0-9]{32}$/i.test(value)) return value;
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let integer = BigInt("0x" + value),
    result = "";
  do {
    result = alphabet[Number(integer % 62n)] + result;
    integer /= 62n;
  } while (integer);
  return result.padStart(22, "0");
}
