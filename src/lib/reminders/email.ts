import { Resend } from "resend";
import type { ReminderEnv } from "./service-client";

export interface DuePlant {
  name: string;
  locationName: string;
  daysOverdue: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function composeDigest(plants: DuePlant[], siteUrl: string): { subject: string; html: string; text: string } {
  const count = plants.length;
  const subject = `${count} plant${count === 1 ? "" : "s"} need watering today`;

  const todayLink = siteUrl ? `${siteUrl}/today` : "/today";

  const plantLines = plants
    .map((p) => {
      const overdue = p.daysOverdue > 0 ? ` (${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue)` : "";
      return `• ${p.name} — ${p.locationName}${overdue}`;
    })
    .join("\n");

  const text = `${subject}\n\n${plantLines}\n\nOpen your plant list: ${todayLink}`;

  const plantHtmlLines = plants
    .map((p) => {
      const overdue =
        p.daysOverdue > 0
          ? ` <span style="color:#e53e3e">(${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue)</span>`
          : "";
      return `<li><strong>${escapeHtml(p.name)}</strong> &mdash; ${escapeHtml(p.locationName)}${overdue}</li>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>${subject}</h2>
  <ul>${plantHtmlLines}</ul>
  <p><a href="${todayLink}">Open your plant list</a></p>
</body>
</html>`;

  return { subject, html, text };
}

export async function sendDigest(
  to: string,
  digest: ReturnType<typeof composeDigest>,
  env: ReminderEnv,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }
  if (!env.REMINDER_FROM_EMAIL) {
    throw new Error("REMINDER_FROM_EMAIL is not set");
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.REMINDER_FROM_EMAIL,
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
