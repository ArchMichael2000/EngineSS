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

export function Select({ value, onValueChange, children }: SelectProps) {
  const options = collectOptions(children);
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      className="h-9 w-full rounded-md border border-hud-line bg-dark-surface px-3 text-sm font-[Rajdhani] text-foreground outline-none focus:border-neon-cyan"
    >
      {!value && <option value="">Load a preset...</option>}
      {options.map((item) => (
        <option key={item.props.value} value={item.props.value}>
          {collectText(item.props.children)}
        </option>
      ))}
    </select>
  );
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
