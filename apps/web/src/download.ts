/**
 * Triggers a browser file save via a temporary object URL + anchor click —
 * the standard client-only download pattern, used by the trip log's export
 * buttons (`tripLog.ts`). Not unit-tested: it's a thin wrapper around
 * `Blob`/`URL.createObjectURL`/DOM APIs with no branching logic of its own,
 * verified instead via a real browser (Playwright), same as `MapView`.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
