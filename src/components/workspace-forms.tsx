"use client";

import { useActionState } from "react";
import {
  createWorkspaceAction,
  deleteWorkspaceAction,
  renameWorkspaceAction,
  updateProfileAction,
} from "@/actions/workspace";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/types";

const initial: ActionState = {};

export function CreateWorkspaceForm() {
  const [state, action] = useActionState(createWorkspaceAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Workspace name" htmlFor="name" error={state.fieldErrors?.name} hint="Usually your company or team name.">
        <Input id="name" name="name" placeholder="Acme Studios" required minLength={2} maxLength={64} autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingText="Creating workspace…">
        Create workspace
      </SubmitButton>
    </form>
  );
}

export function RenameWorkspaceForm({ name, disabled }: { name: string; disabled: boolean }) {
  const [state, action] = useActionState(renameWorkspaceAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Workspace name" htmlFor="ws-name" error={state.fieldErrors?.name}>
        <Input id="ws-name" name="name" defaultValue={name} required minLength={2} maxLength={64} disabled={disabled} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton disabled={disabled} pendingText="Saving…">
        Save changes
      </SubmitButton>
    </form>
  );
}

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, action] = useActionState(updateProfileAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="Full name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" defaultValue={fullName} required minLength={2} maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="email" hint="Email changes are not available in this release.">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
    </form>
  );
}

export function DeleteWorkspaceForm({ name }: { name: string }) {
  const [state, action] = useActionState(deleteWorkspaceAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field
        label={`Type "${name}" to confirm`}
        htmlFor="confirm"
        error={state.fieldErrors?.confirm}
      >
        <Input id="confirm" name="confirm" autoComplete="off" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingText="Deleting…">
        Delete workspace permanently
      </SubmitButton>
    </form>
  );
}
