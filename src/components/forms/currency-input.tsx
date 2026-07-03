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
}

/** Campo de moeda em reais (R$ 1.234,56). Emite o valor numérico em reais. */
export function CurrencyInput({ value, onChange, onBlur, ...rest }: Props) {
  return (
    <NumericFormat
      customInput={Input}
      thousandSeparator="."
      decimalSeparator=","
      decimalScale={2}
      fixedDecimalScale
      allowNegative={false}
      prefix="R$ "
      inputMode="decimal"
      value={value ?? ""}
      onValueChange={(v) => onChange(v.floatValue)}
      onBlur={onBlur}
      {...rest}
    />
  );
}
