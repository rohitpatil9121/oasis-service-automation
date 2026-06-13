// Groq LLM wrapper for the conversational intake agent.
// Returns the raw assistant content (guaranteed JSON via response_format).
import { Groq } from "groq-sdk";
import { env } from "../config/env.js";

let client = null;
function getClient() {
  if (!client) client = new Groq({ apiKey: env.groqApiKey });
  return client;
}

export async function getAIResponse(messages) {
  const completion = await getClient().chat.completions.create({
    model: env.groqModel,
    messages,
    temperature: 0.5,
    response_format: { type: "json_object" },
  });
  return completion.choices[0].message.content;
}
