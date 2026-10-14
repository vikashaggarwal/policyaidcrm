"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { Profile } from "@/lib/types";
import { createUser, resetPassword, setUserActive, setUserRole, type ActionResult } from "./actions";

function randomPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function Notice({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}
    >
      {result.message}
    </p>
  );
}

export function CreateUserForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [result, action, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const res = await createUser(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setPassword("");
    }
    return res;
  }, null);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium">Full name</label>
          <input id="fullName" name="fullName" className="field" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="loginId" className="mb-1 block text-sm font-medium">Login ID</label>
          <input
            id="loginId" name="loginId" className="field" autoComplete="off" autoCapitalize="none"
            spellCheck={false} placeholder="e.g. caller07" required
          />
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium">Role</label>
          <select id="role" name="role" className="field" defaultValue="caller">
            <option value="caller">Caller</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
          <div className="flex gap-2">
            <input
              id="password" name="password" className="field font-mono" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required
            />
            <button type="button" className="btn shrink-0" onClick={() => setPassword(randomPassword())}>
              Generate
            </button>
          </div>
        </div>
      </div>
      <Notice result={result} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}

export function UserRow({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [showReset, setShowReset] = useState(false);
  const [resetResult, resetAction, resetPending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const res = await resetPassword(prev, fd);
    if (res.ok) setShowReset(false);
    return res;
  }, null);

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {user.full_name} {isSelf && <span className="text-sm font-normal text-muted">(you)</span>}
          </p>
          <p className="truncate text-sm text-muted">{user.login_id}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${user.active ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}
        >
          {user.active ? "Active" : "Off"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.full_name}</label>
        <select
          id={`role-${user.id}`} className="field !w-auto" defaultValue={user.role} disabled={isSelf || pending}
          onChange={(e) => start(async () => setResult(await setUserRole(user.id, e.target.value)))}
        >
          <option value="caller">Caller</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <button type="button" className="btn" onClick={() => setShowReset((s) => !s)}>Reset password</button>
        {!isSelf && (
          <button
            type="button" className={`btn ${user.active ? "btn-danger" : ""}`} disabled={pending}
            onClick={() => start(async () => setResult(await setUserActive(user.id, !user.active)))}
          >
            {user.active ? "Switch off" : "Switch on"}
          </button>
        )}
      </div>

      {showReset && (
        <form action={resetAction} className="mt-3 flex gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <label className="sr-only" htmlFor={`pw-${user.id}`}>New password for {user.full_name}</label>
          <input
            id={`pw-${user.id}`} name="password" className="field font-mono" minLength={8}
            defaultValue={randomPassword()} autoComplete="new-password" required
          />
          <button type="submit" disabled={resetPending} className="btn btn-primary shrink-0">Save</button>
        </form>
      )}
      <div className="mt-2 space-y-2">
        <Notice result={result} />
        <Notice result={resetResult} />
      </div>
    </li>
  );
}
