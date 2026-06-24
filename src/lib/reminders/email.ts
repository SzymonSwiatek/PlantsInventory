import { Resend } from "resend";
import type { ReminderEnv } from "./service-client";

export interface DuePlant {
  name: string;
  locationName: string;
  daysOverdue: number;
}

export interface DueWinterPlant {
  name: string;
  locationName: string;
  cutoff: string;
}

export interface DigestInput {
  water: DuePlant[];
  winter: DueWinterPlant[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function composeDigest(
  input: DigestInput,
  siteUrl: string,
  unsubscribeUrl?: string,
): { subject: string; html: string; text: string } {
  const { water, winter } = input;
  const hasWater = water.length > 0;
  const hasWinter = winter.length > 0;

  let subject: string;
  if (hasWater && hasWinter) {
    subject = `${water.length} plant${water.length === 1 ? "" : "s"} need watering and ${winter.length} plant${winter.length === 1 ? "" : "s"} need winterizing today`;
  } else if (hasWater) {
    const count = water.length;
    subject = `${count} plant${count === 1 ? "" : "s"} need watering today`;
  } else {
    const count = winter.length;
    subject = `${count} plant${count === 1 ? "" : "s"} need winterizing today`;
  }

  const todayLink = siteUrl ? `${siteUrl}/today` : "/today";

  // Watering section (text)
  const waterLines = water
    .map((p) => {
      const overdue = p.daysOverdue > 0 ? ` (${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue)` : "";
      return `• ${p.name} — ${p.locationName}${overdue}`;
    })
    .join("\n");

  // Winterization section (text)
  const winterLines = winter.map((p) => `• ${p.name} — ${p.locationName} (cutoff: ${p.cutoff})`).join("\n");

  let text = subject;
  if (hasWater) {
    text += `\n\nNeeds watering:\n${waterLines}`;
  }
  if (hasWinter) {
    text += `\n\nBring indoors or secure before cutoff:\n${winterLines}`;
  }
  text += `\n\nOpen your plant list: ${todayLink}`;
  if (unsubscribeUrl) {
    text += `\n\nUnsubscribe from these reminders: ${unsubscribeUrl}`;
  }

  // Watering section (HTML)
  const waterHtmlLines = water
    .map((p) => {
      const overdue =
        p.daysOverdue > 0
          ? ` <span style="color:#e53e3e">(${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue)</span>`
          : "";
      return `<li><strong>${escapeHtml(p.name)}</strong> &mdash; ${escapeHtml(p.locationName)}${overdue}</li>`;
    })
    .join("\n");

  // Winterization section (HTML)
  const winterHtmlLines = winter
    .map(
      (p) =>
        `<li><strong>${escapeHtml(p.name)}</strong> &mdash; ${escapeHtml(p.locationName)} <span style="color:#718096">(cutoff: ${escapeHtml(p.cutoff)})</span></li>`,
    )
    .join("\n");

  let bodyHtml = "";
  if (hasWater) {
    bodyHtml += `\n  <h3>Needs watering</h3>\n  <ul>${waterHtmlLines}</ul>`;
  }
  if (hasWinter) {
    bodyHtml += `\n  <h3>Bring indoors or secure before cutoff</h3>\n  <ul>${winterHtmlLines}</ul>`;
  }

  const unsubscribeFooter = unsubscribeUrl
    ? `\n  <p style="font-size:12px;color:#718096"><a href="${unsubscribeUrl}">Unsubscribe from these reminders</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>${escapeHtml(subject)}</h2>${bodyHtml}
  <p><a href="${todayLink}">Open your plant list</a></p>${unsubscribeFooter}
</body>
</html>`;

  return { subject, html, text };
}

export async function sendDigest(
  to: string,
  digest: ReturnType<typeof composeDigest>,
  env: ReminderEnv,
  unsubscribeUrl?: string,
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
    ...(unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
