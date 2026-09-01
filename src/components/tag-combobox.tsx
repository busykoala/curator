"use client";

import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export type ComboOption = {
  value: string;
  label: string;
  group: string;
  count: number;
};

type Props = {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  options: ComboOption[];
  change: (values: string[]) => void;
  allowCustom?: boolean;
};

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TagCombobox({
  label,
  hint,
  placeholder,
  values,
  options,
  change,
  allowCustom = true,
}: Props) {
  const id = useId().replaceAll(":", "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const optionMap = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const seen = new Set<string>();
    return options
      .filter((option) => {
        if (values.includes(option.value) || seen.has(option.value)) return false;
        seen.add(option.value);
        return (
          !needle ||
          option.label.toLowerCase().includes(needle) ||
          option.group.toLowerCase().includes(needle)
        );
      })
      .slice(0, 12);
  }, [options, query, values]);

  function add(value: string) {
    const next = value.trim();
    if (!next || values.includes(next)) return;
    change([...values, next]);
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(available.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && available[active]) add(available[active].value);
      else if (allowCustom) add(query);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && !query && values.length) {
      change(values.slice(0, -1));
    }
  }

  return (
    <label className="tag-combobox">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      <div className="tag-field" onClick={() => setOpen(true)}>
        {values.map((value) => (
          <span className="selected-chip" key={value}>
            {optionMap.get(value)?.label ?? readable(value)}
            <button
              type="button"
              aria-label={"Remove " + value}
              onClick={(event) => {
                event.stopPropagation();
                change(values.filter((item) => item !== value));
              }}
            >
              <X />
            </button>
          </span>
        ))}
        <span className="combo-input">
          <Search />
          <input
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={id + "-listbox"}
            aria-activedescendant={
              open && available[active] ? id + "-option-" + active : undefined
            }
            value={query}
            placeholder={values.length ? "Add another…" : placeholder}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={keyDown}
          />
        </span>
      </div>
      {open && (available.length > 0 || (allowCustom && query.trim())) && (
        <div className="combo-popover" id={id + "-listbox"} role="listbox">
          {available.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              id={id + "-option-" + index}
              className={index === active ? "active" : ""}
              key={option.group + ":" + option.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => add(option.value)}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.group}</small>
              </span>
              <em>{option.count.toLocaleString()}</em>
            </button>
          ))}
          {allowCustom &&
            query.trim() &&
            !available.some(
              (option) =>
                option.label.toLowerCase() === query.trim().toLowerCase(),
            ) && (
              <button
                type="button"
                className="custom-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(query)}
              >
                Add “{query.trim()}” as a custom direction
              </button>
            )}
        </div>
      )}
    </label>
  );
}
