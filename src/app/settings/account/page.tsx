"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Account { name: string | null; email: string | null; hasPassword: boolean }

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/account").then((r) => r.json()).then((a: Account) => {
      setAccount(a);
      setName(a.name ?? "");
      setEmail(a.email ?? "");
    });
  }, []);

  if (!account) {
    return <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
  }

  async function send(url: string, method: string, body: unknown, okText: string) {
    setNote(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      setNote({ ok: true, text: okText });
      return true;
    }
    const text =
      res.status === 409 ? "That email is already registered."
      : res.status === 401 ? "Current password required."
      : payload.error ?? "Something went wrong.";
    setNote({ ok: false, text });
    return false;
  }

  const emailChanged = email !== (account.email ?? "");

  return (
    <div className="space-y-5">
      <h1 className="mb-1 text-2xl font-[family-name:var(--font-heading)] italic">Account</h1>
      <p className="mb-6 text-sm text-muted">Your name, sign-in email and password.</p>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">PROFILE</div>
        <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" onClick={() => send("/api/account", "PATCH", { name }, "Name saved.")}>
          Save name
        </Button>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">EMAIL</div>
        {account.hasPassword ? (
          <>
            <Input label="Sign-in email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {emailChanged && (
              <Input
                label="Current password"
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
              />
            )}
            <Button
              size="sm"
              disabled={!emailChanged}
              onClick={() =>
                send("/api/account", "PATCH", { email, currentPassword: emailPassword }, "Email updated.")
              }
            >
              Save email
            </Button>
          </>
        ) : (
          <>
            <Input
              label="Sign-in email"
              type="email"
              value={account.email ?? ""}
              disabled
              className="cursor-not-allowed opacity-60"
            />
            <p className="text-xs text-muted">
              Set a password below before changing your email.
            </p>
          </>
        )}
      </Card>

      <Card className="space-y-4 p-6">
        <div className="text-xs tracking-wide text-muted">
          {account.hasPassword ? "CHANGE PASSWORD" : "SET A PASSWORD"}
        </div>
        {!account.hasPassword && (
          <p className="text-xs text-muted">
            You signed in with Google, so this account has no password yet.
          </p>
        )}
        {account.hasPassword && (
          <Input label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        )}
        <Input
          label="New password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={next && next.length < 8 ? "At least 8 characters" : undefined}
        />
        <Input
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== next ? "Passwords do not match" : undefined}
        />
        <Button
          size="sm"
          disabled={!next || next !== confirm || next.length < 8}
          onClick={async () => {
            const ok = await send(
              "/api/account/password",
              "POST",
              account.hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next },
              "Password updated."
            );
            if (ok) { setCurrent(""); setNext(""); setConfirm(""); setAccount({ ...account, hasPassword: true }); }
          }}
        >
          {account.hasPassword ? "Change password" : "Set password"}
        </Button>
      </Card>

      {note && (
        <p className={note.ok ? "text-xs text-success" : "text-xs text-danger"}>{note.text}</p>
      )}
    </div>
  );
}
