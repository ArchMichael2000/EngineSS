import React, { Children, isValidElement, type ReactNode } from "react";

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

interface SelectItemProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ").trim();
  if (isValidElement(node)) return collectText((node.props as { children?: ReactNode }).children);
  return "";
}

type Entry =
  | { kind: "item"; item: React.ReactElement<SelectItemProps> }
  | { kind: "group"; label: string; items: React.ReactElement<SelectItemProps>[] };

function collectOptions(children: ReactNode): React.ReactElement<SelectItemProps>[] {
  const items: React.ReactElement<SelectItemProps>[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === SelectItem) {
      items.push(child as React.ReactElement<SelectItemProps>);
      return;
    }
    items.push(...collectOptions((child.props as { children?: ReactNode }).children));
  });
  return items;
}

function collectEntries(children: ReactNode): Entry[] {
  const entries: Entry[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === SelectItem) {
      entries.push({ kind: "item", item: child as React.ReactElement<SelectItemProps> });
      return;
    }
    if (child.type === SelectGroup) {
      const props = child.props as SelectGroupProps;
      entries.push({ kind: "group", label: props.label, items: collectOptions(props.children) });
      return;
    }
    entries.push(...collectEntries((child.props as { children?: ReactNode }).children));
  });
  return entries;
}

function renderOption(item: React.ReactElement<SelectItemProps>) {
  return (
    <option key={item.props.value} value={item.props.value}>
      {collectText(item.props.children)}
    </option>
  );
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const entries = collectEntries(children);
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      className="h-9 w-full rounded-md border border-hud-line bg-dark-surface px-3 text-sm font-[Rajdhani] text-foreground outline-none focus:border-neon-cyan"
    >
      {!value && <option value="">Load a preset...</option>}
      {entries.map((entry) =>
        entry.kind === "item" ? (
          renderOption(entry.item)
        ) : (
          <optgroup key={entry.label} label={entry.label}>
            {entry.items.map(renderOption)}
          </optgroup>
        ),
      )}
    </select>
  );
}

interface SelectGroupProps {
  label: string;
  children: ReactNode;
}

/** Rendered as a native <optgroup>. */
export function SelectGroup(_props: SelectGroupProps) {
  return null;
}

export function SelectItem(_props: SelectItemProps) {
  return null;
}

export function SelectTrigger({ children }: { children?: ReactNode; className?: string }) {
  return <>{children}</>;
}

export function SelectValue(_props: { placeholder?: string }) {
  return null;
}

export function SelectContent({ children }: { children: ReactNode; className?: string }) {
  return <>{children}</>;
}
