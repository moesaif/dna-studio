"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Instagram, Linkedin, Facebook, Twitter, Loader2 } from "lucide-react";

interface SocialConnection {
  id: string;
  platform: string;
  accountName: string;
}

const socialPlatforms = [
  {
    id: "instagram",
    name: "Instagram",
    icon: Instagram,
    description: "Connect your Instagram Business account",
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: Facebook,
    description: "Connect your Facebook Page",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: Linkedin,
    description: "Connect your LinkedIn profile",
  },
  {
    id: "twitter",
    name: "X / Twitter",
    icon: Twitter,
    description: "Connect your X account",
  },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);

  // Load connections on mount
  useEffect(() => {
    fetch("/api/settings/connections")
      .then((r) => (r.ok ? r.json() : []))
      .then((c) => {
        setConnections(Array.isArray(c) ? c : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleDisconnect = useCallback(async (connectionId: string) => {
    const res = await fetch(`/api/settings/connections/${connectionId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-[family-name:var(--font-heading)] italic mb-2">
          Connections
        </h1>
        <p className="text-sm text-muted">
          Publish straight to your social accounts.
        </p>
      </div>

      <div className="space-y-3">
        {socialPlatforms.map((platform) => {
          const connection = connections.find(
            (c) => c.platform === platform.id
          );
          return (
            <Card
              key={platform.id}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <platform.icon className="w-5 h-5 text-muted" />
                <div>
                  <h3 className="text-sm font-medium">{platform.name}</h3>
                  <p className="text-xs text-muted">
                    {connection
                      ? `Connected as ${connection.accountName}`
                      : platform.description}
                  </p>
                </div>
              </div>
              {connection ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDisconnect(connection.id)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled>
                  Coming Soon
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
