export interface WebhookMailProviderHandler {
    /**
     * Replys to the email from the webhook
     * @param text The text to reply with
     * @returns The ID of the email sent
     */
    reply(text: string): Promise<string>;
  }