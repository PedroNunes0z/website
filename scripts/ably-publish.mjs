import * as Ably from "ably";

const client = new Ably.Rest({
  key: process.env.ABLY_API_KEY,
  clientId: "your-app",
});

const channel = client.channels.get("my-first-channel");
await channel.publish("message", "hi from my app");
console.log("Mensagem publicada em my-first-channel.");
