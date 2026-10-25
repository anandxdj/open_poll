import { cn } from "@/lib/utils";
import { ROLE_NAMES, type WorkspaceRole } from "../../types";

interface RoleSelectProps {
  value: WorkspaceRole;
  /** Roles that can be chosen; the current value is always shown, even when it is not among them. */
  roles: readonly WorkspaceRole[];
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}

export const selectClass =
  "h-9 rounded-md border border-input bg-card px-2.5 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

/** A native select for a workspace role (keyboard and screen-reader friendly by default). */
export function RoleSelect({ value, roles, onChange, disabled, label, className }: RoleSelectProps) {
  const options = roles.includes(value) ? roles : [value, ...roles];
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as WorkspaceRole)}
      className={cn(selectClass, className)}
    >
      {options.map((role) => (
        <option key={role} value={role} disabled={!roles.includes(role)}>
          {ROLE_NAMES[role]}
        </option>
      ))}
    </select>
  );
}
