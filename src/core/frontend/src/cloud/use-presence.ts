import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { useAuth } from "./AuthProvider";

export interface CloudPeer {
  userId: string;
  email: string | null;
  color: string;
  joinedAt: number;
}

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

interface RawPresence {
  userId: string;
  email: string | null;
  color: string;
  joinedAt: number;
}

export function useCloudPresence(cloudDesignId: string | null): {
  peers: CloudPeer[];
  selfColor: string | null;
} {
  const { user, session } = useAuth();
  const [peers, setPeers] = useState<CloudPeer[]>([]);
  const [selfColor, setSelfColor] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !session || !user || !cloudDesignId) {
      setPeers([]);
      setSelfColor(null);
      return;
    }
    const color = hashColor(user.id);
    setSelfColor(color);

    const channel: RealtimeChannel = sb.channel(`design:${cloudDesignId}`, {
      config: { presence: { key: user.id } },
    });

    const refresh = () => {
      const raw = channel.presenceState<RawPresence>();
      const flat: CloudPeer[] = [];
      for (const [uid, entries] of Object.entries(raw)) {
        if (uid === user.id) continue;
        const first = entries[0];
        if (!first) continue;
        flat.push({
          userId: first.userId,
          email: first.email,
          color: first.color,
          joinedAt: first.joinedAt,
        });
      }
      setPeers(flat);
    };

    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            userId: user.id,
            email: user.email ?? null,
            color,
            joinedAt: Date.now(),
          } satisfies RawPresence);
        }
      });

    return () => {
      void channel.unsubscribe();
      void sb.removeChannel(channel);
    };
  }, [cloudDesignId, session, user]);

  return { peers, selfColor };
}
