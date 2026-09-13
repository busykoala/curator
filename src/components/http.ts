type ErrorBody = { error?: unknown; message?: unknown };

export async function readJson<T>(
  response: Response,
  fallback = "Request failed",
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "The server returned an empty response. Please retry."
        : `${fallback} (${response.status})`,
    );
  }

  let body: T & ErrorBody;
  try {
    body = JSON.parse(text) as T & ErrorBody;
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an unreadable response. Please retry."
        : `${fallback} (${response.status})`,
    );
  }

  if (!response.ok) {
    const detail = body.error ?? body.message;
    throw new Error(typeof detail === "string" ? detail : `${fallback} (${response.status})`);
  }
  return body;
}
