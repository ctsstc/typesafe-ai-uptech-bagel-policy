import type { PolicyResult } from "@bagel/core";
import { useEffect, useRef, useState } from "react";
import { shareText } from "../lib/share";
import { shareUrl } from "../lib/url";
import { AnotherButton } from "./AnotherButton";

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareBar({
  order,
  result,
  onAnother,
}: {
  order: string;
  result: PolicyResult;
  onAnother: () => void;
}) {
  const [status, setStatus] = useState("");
  const [fallback, setFallback] = useState(false);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const url = shareUrl(order);
  const text = shareText(result);

  useEffect(() => {
    if (fallback) fallbackRef.current?.select();
  }, [fallback]);

  const copyLink = async () => {
    const copied = await copyText(url);
    setFallback(!copied);
    setStatus(copied ? "Link copied." : "Couldn't copy. Here's the link:");
  };

  const share = async () => {
    if (typeof navigator.share !== "function" || text === null) return copyLink();
    try {
      await navigator.share({ title: "Bagel Review Board", text, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  };

  return (
    <div className="share">
      <div className="share-buttons">
        {text !== null && (
          <>
            <button type="button" className="button" onClick={share}>
              Share ruling
            </button>
            <button type="button" className="button button-secondary" onClick={copyLink}>
              Copy link
            </button>
          </>
        )}
        <AnotherButton onClick={onAnother} />
        <output className="share-status" aria-live="polite">
          {status}
        </output>
      </div>
      {fallback && (
        <label className="share-fallback">
          <span>Link to this ruling</span>
          <input
            ref={fallbackRef}
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
