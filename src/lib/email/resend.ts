import { Resend } from "resend";
import { config } from "@/lib/config";
import { buildAlertHtml, buildAlertSubject, buildAlertText } from "@/lib/email/template";
import type { AlertSender } from "@/lib/pipeline/ports";
import type { AppRelease } from "@/lib/sources/itunes";
import type { FlankerEvent, TrackedApp } from "@/lib/storage/types";

/**
 * Resend alert delivery.
 *
 * On the free tier without a verified domain, Resend only permits
 * onboarding@resend.dev as the sender and only delivers to the address the
 * account was created with. Both ends are env-configurable so verifying a
 * domain later is a config change rather than a code change.
 *
 * Throws on failure rather than swallowing: the pipeline treats a failed send
 * as a failed run and deliberately leaves the version cursor unadvanced, so
 * the alert is retried instead of lost.
 */
export class ResendAlertSender implements AlertSender {
  private readonly client: Resend;

  constructor(
    apiKey: string = config.email.apiKey,
    private readonly from: string = config.email.from,
    private readonly to: string = config.email.to,
    private readonly baseUrl: string = config.baseUrl,
  ) {
    this.client = new Resend(apiKey);
  }

  async send({
    app,
    release,
    event,
  }: {
    app: TrackedApp;
    release: AppRelease;
    event: FlankerEvent;
  }): Promise<void> {
    const payload = { appName: app.name, release, event, dashboardUrl: this.baseUrl };

    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: this.to,
      subject: buildAlertSubject(app.name, event),
      html: buildAlertHtml(payload),
      text: buildAlertText(payload),
    });

    if (error) {
      // Resend reports failures in the body rather than by throwing, so an
      // unchecked call here would silently look like success.
      throw new Error(`Resend send failed: ${error.name}: ${error.message}`);
    }

    // A 200 from Resend means accepted for delivery, not delivered. Log the id
    // so a missing email can be traced in the Resend dashboard — a send-only
    // API key can't query delivery status.
    console.log(`[flanker] alert accepted by Resend for ${app.name} v${event.version}: ${data?.id}`);
  }
}
