export async function determineIntent(message, currentAgent) {
    const systemPrompt = `You are an intelligent routing system for a recruitment platform. Your SOLE purpose is to classify the user's intent into exactly ONE of the pre-defined target agents.

CURRENT AGENT CONTEXT:
The user is currently talking to the agent: "${currentAgent || 'none'}"
If the user's message is a follow-up ("yes", "generate it", "looks good", "make it shorter", "add more details"), you MUST stick to the CURRENT AGENT. Do not switch agents for general conversational follow-ups.

AVAILABLE AGENTS:
1. job_description_generator
Use this agent if the user wants to write, structure, or formalize a professional job description outlining responsibilities, qualifications, and requirements.
*CRITICAL MATCH*: If the user says "Let's create a full job profile step-by-step", you MUST select this agent.

2. job_ad_creator
Use this agent if the user wants to create a marketing-style job advertisement meant to attract candidates with persuasive, promotional, or engaging language.

3. modify_document
Use this agent if the user has ALREADY generated a document and is asking to modify, update, change text, or follow up on it (e.g., "change the company name to Google", "add Python to the skills", "make it shorter", "rephrase the intro").

RULES:
- You must NEVER generate the actual content (description or ad).
- You must ONLY return a JSON object with the requested properties.
- If the intent is unclear, make your best guess and lower the confidence score.
- The 'agent' MUST be exactly "job_description_generator", "job_ad_creator", "modify_document", or "unsupported_intent".`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            response_format: { 
                type: "json_schema", 
                json_schema: {
                    name: "intent_classification",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            agent: {
                                type: "string",
                                description: "The agent to route to.",
                                enum: ["job_description_generator", "job_ad_creator", "modify_document", "unsupported_intent"]
                            },
                            confidence: {
                                type: "number",
                                description: "Confidence score between 0.0 and 1.0"
                            }
                        },
                        required: ["agent", "confidence"],
                        additionalProperties: false
                    }
                } 
            }
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI API returned status: ${response.status}`);
    }

    const openAiResponse = await response.json();
    try {
        const data = JSON.parse(openAiResponse.choices[0].message.content);
        if (data && data.agent) return data;
    } catch (e) {
        console.error('OpenAI returned invalid JSON:', openAiResponse.choices[0].message.content);
    }
    return { agent: 'unsupported_intent', confidence: 0 };
}
