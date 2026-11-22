"use client";

import { useActionState } from "react";
import { createProjectAction, deleteProjectAction, updateProjectAction } from "@/actions/projects";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";
import { PROJECT_STATUS_LABEL } from "@/lib/utils";
import type { ActionState, Project } from "@/lib/types";

const initial: ActionState = {};

export function ProjectForm({ project }: { project?: Project }) {
  const [state, action] = useActionState(project ? updateProjectAction : createProjectAction, initial);
  return (
    <form action={action} className="space-y-5">
      {project && <input type="hidden" name="id" value={project.id} />}
      <Field label="Project name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={project?.name} placeholder="Spring launch campaign" required maxLength={120} />
      </Field>
      <Field label="Description" htmlFor="description" error={state.fieldErrors?.description} hint="Goal, audience, channels — anything the team should know.">
        <Textarea id="description" name="description" defaultValue={project?.description ?? ""} rows={4} maxLength={2000} />
      </Field>
      <Field label="Status" htmlFor="status" error={state.fieldErrors?.status}>
        <Select id="status" name="status" defaultValue={project?.status ?? "draft"}>
          {Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton pendingText={project ? "Saving…" : "Creating…"}>{project ? "Save changes" : "Create project"}</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteProjectForm({ id }: { id: string }) {
  const [state, action] = useActionState(deleteProjectAction, initial);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = (e.currentTarget.elements.namedItem("ack") as HTMLInputElement | null)?.checked;
        if (!ok) e.preventDefault();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={id} />
      <label className="flex items-start gap-2.5 text-sm text-fg-2">
        <input type="checkbox" name="ack" required className="mt-0.5 size-4 accent-[var(--danger)]" />
        I understand this permanently deletes the project. Scripts stay in the studio, unlinked.
      </label>
      <FormMessage state={state} />
      <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
        Delete project
      </SubmitButton>
    </form>
  );
}
