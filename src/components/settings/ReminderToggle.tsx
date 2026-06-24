import { useState } from "react";
import { toast, Toaster } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface Props {
  remindersEnabled: boolean;
}

export default function ReminderToggle({ remindersEnabled: initial }: Props) {
  const [enabled, setEnabled] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function handleChange(next: boolean) {
    setEnabled(next);
    setLoading(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remindersEnabled: next }),
      });
      if (!res.ok) throw new Error("preferences_failed");
      toast.success(next ? "Reminders enabled" : "Reminders disabled");
    } catch {
      setEnabled(!next);
      toast.error("Could not update preference. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Toaster richColors position="bottom-right" />
      <div className="flex items-center gap-3">
        <Switch
          id="reminders-toggle"
          checked={enabled}
          onCheckedChange={(next) => void handleChange(next)}
          disabled={loading}
          aria-label="Toggle reminder emails"
        />
        <Label htmlFor="reminders-toggle" className="cursor-pointer text-white/80">
          {enabled ? "Reminder emails are on" : "Reminder emails are off"}
        </Label>
      </div>
    </>
  );
}
