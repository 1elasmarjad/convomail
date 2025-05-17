import { WebhookMailProviderHandler } from "../webhooks";
import { type MailgunEmailData, parseEmailFormData } from "./parsing";

type MailgunReplyOptions = {
  sender: {
    name: string;
    email: string;
  };
  replyTo: string;
};

type MailgunSendResponse = {
  id: string;
  message: string;
};

/**
 * Creates the webhook handler for Mailgun
 * @param webhookData The raw webhook data
 * @param auth The authentication credentials for Mailgun
 * @param reply Required information for replying to the email
 * @returns A new Mailgun handler
 */
export default function mailgun(
  webhookData: FormData,
  auth: { apiKey: string; domain: string },
  reply: MailgunReplyOptions
) {
  const parsedWebhookData: MailgunEmailData = parseEmailFormData(webhookData);
  return new WebhookMailgunHandler(parsedWebhookData, auth, reply);
}

class WebhookMailgunHandler implements WebhookMailProviderHandler {
  private readonly apiKey: string;
  private readonly domain: string;
  private readonly webhookData: MailgunEmailData;
  private readonly sender: MailgunReplyOptions["sender"];
  private readonly replyTo: MailgunReplyOptions["replyTo"];

  constructor(
    webhookData: MailgunEmailData,
    auth: { apiKey: string; domain: string },
    reply: MailgunReplyOptions
  ) {
    this.apiKey = auth.apiKey;
    this.domain = auth.domain;
    this.webhookData = webhookData;
    this.sender = reply.sender;
    this.replyTo = reply.replyTo;
  }

  /**
   * Determines the subject of the reply, if the subject starts with "Re: " it will be returned as is, otherwise "Re: " will be prepended
   * @returns The subject of the reply,
   */
  private determineReplySubject(): string {
    const subject = this.webhookData.Subject;
    if (subject.startsWith("Re: ")) {
      return subject;
    }

    return `Re: ${subject}`;
  }

  async reply(text: string): Promise<string> {
    if (!this.sender) {
      throw new Error("Sender is not set");
    }

    if (!this.replyTo) {
      throw new Error("Reply-To is not set");
    }

    const form = new FormData();

    form.append("from", `${this.sender.name} <${this.sender.email}>`);
    form.append("to", this.webhookData.From);
    form.append("subject", this.determineReplySubject());
    form.append("text", text);
    form.append("h:Reply-To", this.replyTo);
    form.append("h:In-Reply-To", this.webhookData["Message-Id"]);

    if (this.webhookData.References) {
      form.append("h:References", this.webhookData.References.join(" "));
    }

    const response = await fetch(
      `https://api.mailgun.net/v3/${this.domain}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${this.apiKey}`)}`,
        },
        body: form,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send email: ${await response.json()}`);
    }

    const data: MailgunSendResponse = await response.json();
    return data.id;
  }

  /**
   * Gets the root message ID of the thread
   * @returns The root message ID of the thread, if there is no root message ID, the message ID of the webhook will be returned
   */
  async getThreadRootMessageId(): Promise<string> {
    if (!this.webhookData.References) {
      return this.webhookData["Message-Id"];
    }

    return this.webhookData.References[0];
  }
}
