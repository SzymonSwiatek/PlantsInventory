import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { canDecrement, stepValue } from "@/lib/number-stepper";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Input } from "./input";

interface NumberStepperProps {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  min?: number;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

function NumberStepper({
  value,
  onChange,
  id,
  min = 1,
  className,
  inputClassName,
  placeholder,
  autoFocus,
  disabled,
  onKeyDown,
}: NumberStepperProps) {
  return (
    <div data-slot="number-stepper" className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Decrease watering interval"
        disabled={disabled ?? !canDecrement(value, min)}
        onClick={() => {
          onChange(stepValue(value, -1, min));
        }}
      >
        <Minus />
      </Button>
      <Input
        id={id}
        type="number"
        min={min}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onKeyDown={onKeyDown}
        className={cn(
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          inputClassName,
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Increase watering interval"
        disabled={disabled}
        onClick={() => {
          onChange(stepValue(value, 1, min));
        }}
      >
        <Plus />
      </Button>
    </div>
  );
}

export { NumberStepper };
