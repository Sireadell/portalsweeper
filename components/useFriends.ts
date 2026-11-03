"use client";
import { useCallback, useEffect, useState } from "react";
import { signText } from "./signing";
import { todayUTC } from "./dailySalt";
import { socialLoginMessage } from "@/lib/social-message";
import type { Me } from "@/lib/social";

const keyFor = (address: string) => `portalsweeper:friends-sign:${address.toLowerCase()}:${todayUTC()}`;

// The friends list for a connected wallet. It signs in once a day (free) and keeps that signature in this
// tab's session storage, so Accept, Add and Invite do not ask again.
export function useFriends(address: string | null, autoLoad = true) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
      if (!address) return false;
      setError("");
      setBusy(true);
      try {
        let sig: string | null = null;
        try { sig = sessionStorage.getItem(keyFor(address)); } catch { /* storage may be blocked */ }
        if (!sig) {
          sig = await signText(socialLoginMessage(todayUTC()), address);
          try { sessionStorage.setItem(keyFor(address), sig); } catch { /* fine, it asks again next time */ }
        }
        const res = await fetch("/api/friends", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, address, signature: sig, ...extra }),
        });
        const j = await res.json();
        if (!res.ok) {
          if (res.status === 401) { try { sessionStorage.removeItem(keyFor(address)); } catch { /* ignore */ } }
          setError(j.error ?? "Something went wrong.");
          return false;
        }
        setMe(j.me as Me);
        return true;
      } catch {
        setError("No signature was given, so nothing changed. Try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [address],
  );

  useEffect(() => {
    if (address && autoLoad) void call("me");
    else if (!address) setMe(null);
  }, [address, autoLoad, call]);

  return { me, error, busy, call };
}
