import Twilio from "twilio";
import { type MessageInstance } from "twilio/lib/rest/api/v2010/account/message";
import { validateRequest } from "twilio/lib/webhooks/webhooks.js";
import { z } from "zod";

type TwilioClient = ReturnType<typeof Twilio>;

const TwilioWebhookSchema = z.object({
  MessageSid: z.string(),
  AccountSid: z.string(),
  From: z.string(),
  To: z.string(),
  Body: z.string().describe("Text body of the message"),

  FromCity: z.string().optional(),
  FromState: z.string().optional(),
  FromZip: z.string().optional(),
  FromCountry: z.string().optional(),

  // TODO... there are more fields that will be supported in the future
  // https://www.twilio.com/docs/messaging/guides/webhook-request
});

/**
 * Context for a message received from Twilio.
 *
 * @param message - The text body of the message.
 * @param from - The phone number of the sender.
 * @param messageId - The unique identifier for the message.
 */
export type MessageContext = {
  message: string;
  from: string;
  messageId: string;
};

/**
 * A response to a incoming message. A string represnts a text message to send back to the user.
 * If undefined is returned, no reply message will be sent to the user.
 */
export type TwilioIncomingResponse = string | void;

/**
 * A function that handles an incoming message from Twilio.
 *
 * @param context - The context of the message.
 * @returns A response to the message.
 */
type MessageHandler = (
  context: MessageContext
) => Promise<TwilioIncomingResponse>;

class TwilioSMSConvo {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly handlerUrl?: string; // the url handling the webhook

  private readonly handleIncoming: MessageHandler;

  constructor(
    twilioCredentials: {
      accountSid: string;
      authToken: string;
    },
    handleIncoming: MessageHandler,
    handlerUrl?: string
  ) {
    this.accountSid = twilioCredentials.accountSid;
    this.authToken = twilioCredentials.authToken;
    this.handleIncoming = handleIncoming;
    this.handlerUrl = handlerUrl;
  }

  async handlePost(request: Request): Promise<Response> {
    const twilioSignature = request.headers.get("X-Twilio-Signature");

    if (!twilioSignature) {
      console.error("No Twilio signature found");
      return new Response("No Twilio signature found", { status: 401 });
    }

    const formData = await request.formData();
    const params = Object.fromEntries(formData);

    const { success, data, error } = TwilioWebhookSchema.safeParse(params);

    if (!success) {
      console.error("Error validating Twilio webhook, invalid schema", error);
      return new Response("Invalid Twilio webhook", { status: 400 });
    }

    const { Body, From, MessageSid } = data;

    const validRequest: boolean = validateRequest(
      this.authToken,
      twilioSignature,
      this.handlerUrl ?? request.url,
      params
    );

    if (!validRequest) {
      console.error("Error validating Twilio webhook, invalid signature");
      return new Response("Invalid Twilio webhook", { status: 401 });
    }

    const response = await this.handleIncoming({
      message: Body,
      from: From,
      messageId: MessageSid,
    });

    const twiml = new Twilio.twiml.MessagingResponse();
    twiml.message(response ?? "");

    return new Response(twiml.toString(), {
      headers: {
        "Content-Type": "text/xml",
      },
    });
  }

  async send(
    message: string,
    from: string,
    to: string,
    twilio: TwilioClient
  ): Promise<MessageInstance> {
    return twilio.messages.create({
      body: message,
      from,
      to,
    });
  }
}

/**
 * Options for the Twilio SMS service.
 *
 * @param credentials - The credentials for the Twilio account.
 * @param onMessage - A function that handles an incoming message from Twilio.
 * @param handlerUrl - The URL that Twilio will send the webhook to.
 */
type TwilioOptions = {
  credentials: {
    accountSid: string;
    authToken: string;
  };
  handlerUrl?: string;
};

/**
 * Creates a Twilio SMS service using Talkkit.
 *
 * @param onMessage - A function that handles an incoming message from Twilio. The function should can return a string to send back to reply to the user.
 * @param options - The options for the Twilio SMS service.
 * @returns A Twilio SMS service.
 */
export function twilio({
  onMessage,
  options,
}: {
  onMessage: MessageHandler;
  options: TwilioOptions;
}): {
  handlers: {
    POST: (request: Request) => Promise<Response>;
  };
  sendSMS: (message: string, from: string, to: string) => Promise<MessageInstance>;
} {
  const convo = new TwilioSMSConvo(
    {
      accountSid: options.credentials.accountSid,
      authToken: options.credentials.authToken,
    },
    onMessage,
    options.handlerUrl
  );

  const twilio = Twilio(
    options.credentials.accountSid,
    options.credentials.authToken
  );

  return {
    handlers: {
      POST: (request) => convo.handlePost(request),
    },
    sendSMS: (message, from, to) => convo.send(message, from, to, twilio),
  };
}
