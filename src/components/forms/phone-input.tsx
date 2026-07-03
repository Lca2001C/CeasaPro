"use client";

import { PatternFormat } from "react-number-format";
import { Input } from "@/components/ui/input";

interface Props {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  id?: string;
  name?: string;
  disabled?: boolean;
}

/** Telefone (00) 00000-0000 — emite apenas os dígitos. */
export function PhoneInput({ value, onChange, onBlur, ...rest }: Props) {
  return (
    <PatternFormat
      customInput={Input}
      format="(##) #####-####"
      mask="_"
      inputMode="numeric"
      value={value ?? ""}
      onValueChange={(v) => onChange(v.value)}
      onBlur={onBlur}
      placeholder="(31) 99999-9999"
      {...rest}
    />
  );
}
