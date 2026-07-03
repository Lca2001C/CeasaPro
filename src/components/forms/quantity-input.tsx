"use client";

import { NumericFormat } from "react-number-format";
import { Input } from "@/components/ui/input";

interface Props {
  value: number | null | undefined;
  onChange: (value: number | undefined) => void;
  onBlur?: () => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
}

/** Campo de quantidade (aceita até 3 casas decimais, ex.: kg). */
export function QuantityInput({ value, onChange, onBlur, suffix, ...rest }: Props) {
  return (
    <NumericFormat
      customInput={Input}
      thousandSeparator="."
      decimalSeparator=","
      decimalScale={3}
      allowNegative={false}
      suffix={suffix ? ` ${suffix}` : undefined}
      inputMode="decimal"
      value={value ?? ""}
      onValueChange={(v) => onChange(v.floatValue)}
      onBlur={onBlur}
      {...rest}
    />
  );
}
