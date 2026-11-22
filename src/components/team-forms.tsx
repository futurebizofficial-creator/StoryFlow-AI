"use client";

import { useActionState, useState } from "react";
import { inviteMemberAction, removeMemberAction, updateMemberRoleAction } from "@/actions/team";
import { Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import type { ActionState, WorkspaceRole } from "@/lib/types";

const initial: ActionState = {};

export function InviteForm({ canInviteAdmins }: { canInviteAdmins: boolean }) {
  const [state, action] = useActionState(inviteMemberAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
        <Field label="Email address" htmlFor="invite-email" error={state.fieldErrors?.email}>
          <Input id="invite-email" name="email" type="email" placeholder="teammate@company.com" required />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue="member">
            <option value="member">Member</option>
            {canInviteAdmins && <option value="admin">Admin</option>}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Inviting…">
        <Icon name="mail" /> Create invitation
      </SubmitButton>
    </form>
  );
}

export function RoleSelect({
  userId,
  role,
  allowed,
}: {
  userId: string;
  role: WorkspaceRole;
  allowed: WorkspaceRole[];
}) {
  const [state, action, pending] = useActionState(updateMemberRoleAction, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        disabled={pending}
        aria-label="Change role"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] outline-none focus:border-accent"
      >
        {allowed.map((r) => (
          <option key={r} value={r}>
            {r[0].toUpperCase() + r.slice(1)}
          </option>
        ))}
      </select>
      {state.error && <span className="max-w-48 text-right text-[11px] text-danger">{state.error}</span>}
    </form>
  );
}

export function RemoveMemberButton({ userId, self }: { userId: string; self: boolean }) {
  const [state, action] = useActionState(removeMemberAction, initial);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg px-2 py-1 text-[12px] font-medium text-muted hover:bg-danger-soft hover:text-danger"
      >
        {self ? "Leave" : "Remove"}
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1">
        <SubmitButton variant="danger" size="sm" pendingText="…">
          Confirm
        </SubmitButton>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-2 py-1 text-[12px] text-muted hover:text-fg">
          Cancel
        </button>
      </div>
      {state.error && <span className="max-w-48 text-right text-[11px] text-danger">{state.error}</span>}
    </form>
  );
}

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy this invite link", url);
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2"
    >
      <Icon name={copied ? "check" : "copy"} size={13} />
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
