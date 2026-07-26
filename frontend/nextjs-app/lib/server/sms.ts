export type SendSmsInput = {
  to: string;
  body: string;
};

export async function sendSms({ to, body }: SendSmsInput) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const fromNumber = process.env.TWILIO_SMS_FROM?.trim();

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error("Twilio messaging credentials are incomplete");
  }

  const payload = new URLSearchParams();
  payload.set("To", to);
  payload.set("Body", body);
  if (messagingServiceSid) {
    payload.set("MessagingServiceSid", messagingServiceSid);
  } else {
    payload.set("From", fromNumber!);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Twilio request failed");
    throw new Error(message || "Twilio request failed");
  }

  return (await response.json().catch(() => ({}))) as { sid?: string; status?: string };
}
