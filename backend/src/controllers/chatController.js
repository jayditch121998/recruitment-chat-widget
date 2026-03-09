import OpenAI from 'openai';
import { AGENT_CATALOG, AGENT_API_BASE_URL } from '../config/agents.js';

// Initialize openAI and store session history
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const sessionMemory = new Map();

// --- BEGIN NEW LOGIC PORTED FROM PYTHON ---
const SESSION_DATA = {};

function getSession(sessionId) {
    if (!SESSION_DATA[sessionId]) {
        SESSION_DATA[sessionId] = {
            company_name: null,
            last_job_title: null,
            accumulated_fields: {},
            pending: null
        };
    }
    return SESSION_DATA[sessionId];
}

function replaceInventedCompany(text) {
    if (typeof text !== 'string') return text;
    let inventedName = null;

    let match = text.match(/\*\*About\s+([^*]+)\*\*/i);
    if (match) {
        inventedName = match[1].trim();
    }

    if (!inventedName) {
        match = text.match(/(?:^|\n)([A-Z][A-Za-z0-9& ,.]{1,50}?)\s+is\s+a\b/m);
        if (match) {
            let candidate = match[1].trim().replace(/,$/, '').trim();
            const skip = new Set(["The", "This", "We", "Our", "A", "An", "Position"]);
            if (!skip.has(candidate) && candidate.length > 1) {
                inventedName = candidate;
            }
        }
    }

    if (inventedName) {
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(escapeRegExp(inventedName), 'g'), '[Company Name]');
    }
    return text;
}

async function understandUserIntent(userMessage, conversationHistory, currentJobTitle) {
    const systemPrompt = `You are an intent understanding engine for a recruitment chatbot.
Analyze the user message based on the conversation history.
Current Job Title: ${currentJobTitle || 'None'}

Extract the following fields from the user message if present:
- intent: one of ["change_role", "edit_jd", "auto_fill", "create_new", "provide_info"]
  "change_role": User wants a completely different role than before (e.g. "Actually I want a developer").
  "edit_jd": User wants to tweak the existing job description.
  "auto_fill": User tells you to fill missing details (e.g. "fill those for me", "skip", "auto fill").
  "create_new": User is starting a new JD or providing initial details for a completely new JD.
  "provide_info": User is answering questions/providing details (skills, department, etc.) to help build the JD.
- job_title: the job role requested.
- company_name: the company name if explicitly mentioned.
- skills: required skills mentioned.
- department: department or team mentioned.
- experience_level: e.g., Junior, Senior, 3 years.
- tasks: tasks or responsibilities mentioned.
- location: job location (e.g. Remote, New York, Hybrid).
- salary_range: compensation details (e.g. $50k-$70k, competitive, hourly rate).
- target_platforms: social media platforms for ads (e.g. LinkedIn, Facebook, Indeed).

Respond ONLY in valid JSON. Format example:
{"intent": "provide_info", "job_title": "React Developer", "company_name": "Google", "skills": "React, Node.js", "department": "Engineering", "experience_level": "Senior", "tasks": "Code, review PRs", "location": "Remote", "salary_range": "$120k-$150k", "target_platforms": "LinkedIn"}`;

    const historyForPrompt = conversationHistory.map(msg => ({ role: msg.role, content: typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content }));

    try {
        console.log("\n==========================================");
        console.log("[LOGGER] 🧠 Calling OpenAI API to Understand Intent...");
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                ...historyForPrompt,
                { role: "user", content: userMessage }
            ],
            response_format: { type: "json_object" },
            temperature: 0
        });
        const response = JSON.parse(chatCompletion.choices[0].message.content);
        console.log("[LOGGER] ✅ Response from OpenAI API (Intent):", response);
        return response;
    } catch (e) {
        console.error("Intent parsing error", e);
        return { intent: "provide_info" };
    }
}

async function autoFillMissingFields(jobTitle, experienceLevel, existingFields) {
    const systemPrompt = `You are an expert HR job description writer.
Given the following details, auto-fill reasonable defaults for the missing fields.
Job Title: ${jobTitle}
Experience Level: ${experienceLevel || 'Not specified'}
Existing Fields: ${JSON.stringify(existingFields)}

Only return a JSON object with the generated values for the missing/empty fields: "skills", "department", "tasks", "location", "salary_range", "target_platforms".
Respond ONLY in valid JSON format. Example:
{"skills": "JavaScript, React", "department": "Engineering", "tasks": "Develop web applications", "location": "Remote", "salary_range": "Competitive", "target_platforms": "LinkedIn, Indeed"}`;

    try {
        console.log("\n==========================================");
        console.log("[LOGGER] 🧠 Calling OpenAI API to Auto-fill Fields...");
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Please auto-fill the missing fields." }
            ],
            response_format: { type: "json_object" },
            temperature: 0
        });
        const response = JSON.parse(chatCompletion.choices[0].message.content);
        console.log("[LOGGER] ✅ Response from OpenAI API (Auto-fill):", response);
        return response;
    } catch (e) {
        return {};
    }
}
// --- END NEW LOGIC ---

/**
 * 1. POST /route -> local intent classifier via OpenAI
 */
export const routeMessage = async (req, res) => {
    try {
        const { message, sessionId, activeAgent } = req.body;
        console.log("Routing message:", message, "Session:", sessionId, "ActiveAgent:", activeAgent);
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (!sessionMemory.has(sessionId)) {
            sessionMemory.set(sessionId, []);
        }
        const history = sessionMemory.get(sessionId);

        // Keep last 10 messages
        if (history.length >= 10) history.shift();
        history.push({ role: 'user', content: message });

        const systemPrompt = `You are an AI routing engine.

        Your task is to decide which backend agent should handle the user's request.

        Available agents:

        1. job_description_generator
        - Used when the user wants a structured job description.
        - Includes responsibilities, qualifications, and role details.

        2. job_ad_creator
        - Used when the user wants a marketing-style job advertisement.
        - Includes persuasive hiring language and promotional content.

        CRITICAL: The user is currently interacting with the agent: ${activeAgent || 'None'}. If their message is answering a question, a short follow-up (like "Junior Laravel Developer", "Yes", or listing skills), or continuing the conversation flow, YOU MUST return the current active agent.

        If the user message is completely unrelated to job creation/hiring, and they are NOT actively answering a question, return: "unsupported_intent".

        Rules:
        - Respond ONLY in valid JSON.
        - Do NOT include explanations.
        - Do NOT generate job content.
        - Use this exact format:

        {
        "agent": "job_description_generator" | "job_ad_creator" | "unsupported_intent",
        "confidence": number between 0 and 1
        }`;

        let data = { agent: 'job_description_generator', confidence: 0.5 };

        try {
            console.log("\n==========================================");
            console.log("[LOGGER] 🧠 Calling OpenAI API for Intention Routing...");
            const chatCompletion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // fast and reliable for json routing
                messages: [
                    { role: "system", content: systemPrompt },
                    ...history
                ],
                response_format: { type: "json_object" },
                temperature: 0
            });

            const rawText = chatCompletion.choices[0].message.content;
            console.log("[LOGGER] ✅ Response from OpenAI API (Router):", rawText);
            data = JSON.parse(rawText);

            // Keep the assistant's previous choice in memory
            history.push({ role: 'assistant', content: rawText });
            if (history.length >= 10) history.shift();

        } catch (e) {
            console.error('OpenAI Router Error:', e.message);
        }

        // Safety check fallback
        if (!data || !data.agent) {
            console.warn('OpenAI returned missing/invalid agent property. Falling back to default.');
            data = { agent: 'job_description_generator', confidence: 0.5 };
        }

        return res.json(data);
    } catch (error) {
        console.error('Error calling intent routing logic:', error);
        return res.status(500).json({ error: 'Failed to route message' });
    }
};

/**
 * 2. GET /chat-stream -> streams agent response
 */
export const streamChat = async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { message, agent, sessionId, configurationId } = req.query;
    console.log(message, agent, sessionId, configurationId);
    if (!message || !agent || !sessionId) {
        res.write(`data: ${JSON.stringify({ error: 'Message, agent, and sessionId are required' })}\n\n`);
        return res.end();
    }

    const agentConfig = AGENT_CATALOG[agent];
    if (!agentConfig || !agentConfig.isActive) {
        res.write(`data: ${JSON.stringify({ error: 'Invalid or inactive agent selected' })}\n\n`);
        return res.end();
    }

    let finalPrompt = message;
    let currentCompany = null;

    // Apply the python-like logic if it's the job description generator or job ad creator
    if (agent === 'job_description_generator' || agent === 'job_ad_creator') {
        const isAd = agent === 'job_ad_creator';
        const docName = isAd ? "job advertisement" : "job description";

        const session = getSession(sessionId);
        if (!sessionMemory.has(sessionId)) {
            sessionMemory.set(sessionId, []);
        }
        const history = sessionMemory.get(sessionId);

        const understood = await understandUserIntent(message, history, session.last_job_title);
        let intent = understood.intent || "provide_info";
        const extractedTitle = understood.job_title;

        console.log(`[DEBUG] Intent: ${intent}, Title: ${extractedTitle}`);

        if (understood.company_name) {
            if (!message.toLowerCase().includes(understood.company_name.toLowerCase())) {
                console.log(`[DEBUG] Discarding hallucinated company: '${understood.company_name}'`);
                understood.company_name = null;
            } else {
                session.company_name = understood.company_name;
            }
        }

        const changeMatch = message.match(/(?:change|set|update|use)\s+(?:the\s+)?company\s+(?:name\s+)?(?:to|as)\s+(.+)/i);
        if (changeMatch) {
            session.company_name = changeMatch[1].trim().replace(/\.$/, '');
        }

        currentCompany = session.company_name;

        if (intent === 'change_role' && extractedTitle) {
            // Ignore simple short words like 'facebook' being interpreted as a new job code
            if (extractedTitle.length > 2) {
                console.log(`[DEBUG] Changing role: '${session.last_job_title}' → '${extractedTitle}'`);
                session.accumulated_fields = {};
                session.pending = null;
                session.last_job_title = extractedTitle;

                ['skills', 'department', 'experience_level', 'tasks', 'location', 'salary_range', 'target_platforms'].forEach(field => {
                    if (understood[field]) session.accumulated_fields[field] = understood[field];
                });
                intent = 'create_new';
            }
        }

        if (intent === 'edit_jd') {
            let previousJd = "";
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'assistant' && typeof history[i].content === 'string' && history[i].content.length > 200) {
                    previousJd = history[i].content;
                    break;
                }
            }

            if (previousJd) {
                const companyInstruction = currentCompany
                    ? `Use the company name '${currentCompany}' throughout.`
                    : `Use '[Company Name]' as a placeholder. Do NOT invent a company name.`;

                finalPrompt = `
Here is an existing ${docName}:
---
${previousJd}
---

The user wants the following change: ${message}

${companyInstruction}

Please update the ${docName} accordingly. Keep everything else unchanged.`;
            } else {
                intent = 'create_new';
            }
        }

        if (intent === 'auto_fill') {
            console.log("[DEBUG] Auto-fill intent detected — skipping questions");
            intent = 'create_new';
        }

        if (intent === 'create_new' || intent === 'provide_info') {
            const jobTitle = extractedTitle || session.last_job_title || "";

            if (!jobTitle) {
                const followUp = `I'd love to help generate a **${docName}**! Could you tell me the **job title** you're looking for? For example: 'Junior Laravel Developer', 'Senior Data Engineer', etc.`;
                history.push({ role: 'assistant', content: followUp });
                res.write(`data: ${JSON.stringify({ text: followUp })}\n\n`);
                res.write('event: done\ndata: [DONE]\n\n');
                res.end();
                session.pending = { extracted: understood };
                return;
            }

            session.last_job_title = jobTitle;

            if (!session.accumulated_fields) session.accumulated_fields = {};
            const acc = session.accumulated_fields;

            ['skills', 'department', 'experience_level', 'tasks', 'location', 'salary_range', 'target_platforms'].forEach(field => {
                if (understood[field]) acc[field] = understood[field];
            });

            if (session.pending) {
                const prevExtracted = session.pending.extracted || {};
                ['skills', 'department', 'experience_level', 'tasks', 'location', 'salary_range', 'target_platforms'].forEach(field => {
                    if (!acc[field] && prevExtracted[field]) acc[field] = prevExtracted[field];
                });
                session.pending = null;
            }

            let skills = acc.skills;

            if (!skills && understood.intent !== 'auto_fill') {
                const followUp = `Great! I'll create a ${docName} for **${jobTitle}**.\n\nWhat **skills** should this role require? For example: 'Laravel, PHP, Angular', 'Python, AWS, Docker', etc.\n\nOr say **'fill those for me'** to let me decide.`;
                history.push({ role: 'assistant', content: followUp });
                res.write(`data: ${JSON.stringify({ text: followUp })}\n\n`);
                res.write('event: done\ndata: [DONE]\n\n');
                res.end();
                session.pending = { extracted: { ...understood, job_title: jobTitle, ...acc } };
                return;
            }

            let platforms = acc.target_platforms;
            if (isAd && !platforms && understood.intent !== 'auto_fill') {
                const followUp = `Please specify which **platform(s)** you'd like the ad to be created for (LinkedIn, Indeed, Facebook, or all).\n\nOr say **'fill those for me'** to use standard platforms.`;
                history.push({ role: 'assistant', content: followUp });
                res.write(`data: ${JSON.stringify({ text: followUp })}\n\n`);
                res.write('event: done\ndata: [DONE]\n\n');
                res.end();
                session.pending = { extracted: { ...understood, job_title: jobTitle, ...acc } };
                return;
            }

            const fields = { department: acc.department, tasks: acc.tasks, skills: skills, location: acc.location, salary_range: acc.salary_range, target_platforms: platforms };
            const autoFillNeeded = Object.keys(fields).filter(k => !fields[k]);

            if (autoFillNeeded.length > 0) {
                res.write(`data: ${JSON.stringify({ text: `*Generating missing details automatically...*\n\n` })}\n\n`);
                console.log(`[DEBUG] Auto-filling: ${autoFillNeeded}`);
                const autoFilled = await autoFillMissingFields(jobTitle, acc.experience_level, fields);
                autoFillNeeded.forEach(field => {
                    if (autoFilled[field]) fields[field] = autoFilled[field];
                });
            }

            skills = fields.skills || skills;
            const companyLine = currentCompany
                ? `Company: ${currentCompany}`
                : `Company: [Company Name] (use exactly this placeholder, do NOT invent a company name)`;

            let additionalContext = "";
            if (message.length > 500) {
                additionalContext = `\nRaw reference text provided by user:\n---\n${message}\n---\n`;
            }

            finalPrompt = `${companyLine}
Job Title: ${jobTitle}
Target Platform(s): ${fields.target_platforms || 'LinkedIn, Indeed, Facebook'}
Department: ${fields.department || 'General'}
Location: ${fields.location || 'Not specified'}
Experience Level: ${acc.experience_level || 'Not specified'}
Salary Range: ${fields.salary_range || 'Not specified'}
Tasks/Responsibilities: ${fields.tasks || 'General duties'}
Skills: ${skills}
${additionalContext}`.trim();

            const previewText = `**Job Details Gathered:**\n* **Job Title:** ${jobTitle}\n* **Skills:** ${skills}\n* **Platforms:** ${fields.target_platforms || 'Standard (LinkedIn, Indeed)'}\n* **Location:** ${fields.location || 'Not specified'}\n\n*Generating documents...*\n\n---\n\n`;
            res.write(`data: ${JSON.stringify({ text: previewText })}\n\n`);
        }

        console.log(`[DEBUG] Final prompt preview: ${finalPrompt.substring(0, 300)}`);
    }

    try {
        let activeConfigurationId = configurationId;

        // 1. Call startConversation API ONLY if we haven't locked into a configuration ID for this topic yet
        if (!activeConfigurationId) {
            const requestUrl = `${AGENT_API_BASE_URL}/api/v2/startConversation`;
            const payload = {
                tenantAgentId: agentConfig.tenantId,
                configurationName: agentConfig.configName,
                sessionId: sessionId,
            };

            console.log("\n==========================================");
            console.log("[LOGGER] 📞 Calling Agentix AI (startConversation)...");
            console.log("[LOGGER] 🔗 URL:", requestUrl);
            console.log("[LOGGER] 📦 Payload:", JSON.stringify(payload, null, 2));

            const startRes = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.AGENT_API_KEY}`
                },
                body: JSON.stringify(payload)
            });

            if (!startRes.ok) throw new Error(`Failed to start conversation: ${startRes.status}`);

            const startData = await startRes.json();
            console.log("[LOGGER] ✅ Response from Agentix AI (startConversation):", startData);
            activeConfigurationId = startData.AgentChatConfigurationId || startData.agentChatConfigurationId;

            if (!activeConfigurationId) {
                throw new Error('No AgentChatConfigurationId returned from Agent API');
            }

            // Immediately send back to frontend so it can save configurationId state
            res.write(`data: ${JSON.stringify({ configurationId: activeConfigurationId })}\n\n`);
        }

        // 2. Stream Agent Output using multipart form-data
        const formData = new FormData();
        formData.append('configurationId', activeConfigurationId);

        // Include userPrompt parameter on the stream call for all active agents
        formData.append('userPrompt', finalPrompt);
        // formData.append('workspaceId', agentConfig.workspaceId);

        const requestUrl = `${AGENT_API_BASE_URL}/api/1/chat/chat-stream`;
        const payloadObj = {};
        for (const [key, value] of formData.entries()) {
            payloadObj[key] = value;
        }

        console.log("\n==========================================");
        console.log("[LOGGER] 🚀 Calling Agentix AI (chat-stream) NOW >>...");
        console.log("[LOGGER] 🔗 URL:", requestUrl);
        console.log("[LOGGER] 📦 Payload (FormData):", JSON.stringify(payloadObj, null, 2));

        const streamRes = await fetch(requestUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.AGENT_API_KEY}`
            },
            body: formData
        });

        if (!streamRes.ok) {
            const errorText = await streamRes.text();
            throw new Error(`Stream request failed with status: ${streamRes.status}. Body: ${errorText}`);
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        // Handle client disconnect gracefully
        req.on('close', () => {
            console.log('Client closed connection');
            reader.cancel();
        });

        // 3. Parse Stream Chunks in Real-Time
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Log every chunk (uncomment if you want to see all exact chunks)
                // console.log("[Stream Chunk]:", trimmed);

                // Handle both raw JSON streams and 'data: ' prefix Streams
                let jsonStr = trimmed;
                if (jsonStr.startsWith('data:')) {
                    jsonStr = jsonStr.replace(/^data:\s*/, '').trim();
                }

                if (jsonStr === '[DONE]') continue;

                // Try to loosely parse complete JSON objects emitted by the Agent
                if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(jsonStr);

                        if (parsed.event === 'RunContent' && parsed.content) {
                            // The PopApps Agent aggressively streams out raw JSON properties token by token
                            // Example: '{"action"', ': "GATHER_INFO"'
                            let sanitized = parsed.content
                                .replace(/```json/g, '')
                                .replace(/```/g, '')
                                .replace(/"action":.*?,/g, '')
                                .replace(/"response"\s*:\s*"/g, '')
                                .replace(/"description"\s*:\s*"/g, '')
                                .replace(/"[a-zA-Z0-9_]+"\s*:\s*\{/g, '')
                                .replace(/"jobTitle"\s*:\s*".*?",?/gi, '')
                                .replace(/^\{|\}$/g, '')
                                .replace(/\\\\n/g, '\n')
                                .replace(/\\n/g, '\n')
                                .replace(/\n{3,}/g, '\n\n');

                            if (sanitized.trim().length > 0) {
                                res.write(`data: ${JSON.stringify({ text: sanitized })}\n\n`);
                            }
                        }

                        // Fallback logic to process end-payload JSON safely
                        if (parsed.event === 'RunCompleted' && parsed.content) {
                            try {
                                let cleanContent = parsed.content;
                                let leadingText = "";

                                // Check if there's text before a JSON block
                                const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    const rawJson = jsonMatch[0];
                                    leadingText = cleanContent.substring(0, cleanContent.indexOf(rawJson)).trim();
                                    // Clean up lingering bits like ```json
                                    leadingText = leadingText.replace(/```(json)?\s*$/i, '').trim();
                                    cleanContent = rawJson;
                                } else {
                                    // Sometimes the agent returns stringified JSON, e.g. "```json{...}```"
                                    cleanContent = cleanContent.replace(/^```json/g, '').replace(/```$/g, '').trim();
                                }

                                // Some LLMs double-string encode
                                if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
                                    cleanContent = JSON.parse(cleanContent);
                                }

                                const structuredParsed = JSON.parse(cleanContent);
                                let finalContent = structuredParsed.response || structuredParsed.full_description || structuredParsed.jobAds || structuredParsed.jobDescription;

                                if (!finalContent && structuredParsed.platforms) {
                                    let adParts = [];
                                    for (const [platform, data] of Object.entries(structuredParsed.platforms)) {
                                        let platformAd = `### ${platform.charAt(0).toUpperCase() + platform.slice(1)} Ad\n\n`;
                                        if (typeof data === 'string') {
                                            platformAd += data;
                                        } else if (data.description) {
                                            platformAd += data.description;
                                        } else if (data.ad_copy) {
                                            platformAd += data.ad_copy;
                                        } else if (data.content) {
                                            platformAd += data.content;
                                        } else {
                                            const innerVals = Object.values(data).filter(v => typeof v === 'string');
                                            platformAd += innerVals.join('\n\n');
                                            if (innerVals.length === 0) {
                                                platformAd += JSON.stringify(data, null, 2);
                                            }
                                        }
                                        adParts.push(platformAd);
                                    }
                                    finalContent = adParts.join('\n\n---\n\n');
                                } else if (!finalContent) {
                                    const stringVals = [];
                                    const traverse = (obj) => {
                                        for (const [key, val] of Object.entries(obj)) {
                                            if (typeof val === 'string' && key.toLowerCase() !== 'jobtitle' && key.toLowerCase() !== 'industry' && key.toLowerCase() !== 'senioritylevel' && key.toLowerCase() !== 'employmenttype') {
                                                stringVals.push(val);
                                            } else if (typeof val === 'object' && val !== null) {
                                                traverse(val);
                                            }
                                        }
                                    };
                                    traverse(structuredParsed);
                                    if (stringVals.length > 0) {
                                        finalContent = stringVals.join('\n\n---\n\n');
                                    } else {
                                        finalContent = JSON.stringify(structuredParsed, null, 2);
                                    }
                                }

                                // If it successfully parses into the JobAdResponse schema or finds a response
                                if (finalContent) {
                                    if (leadingText) {
                                        finalContent = leadingText + '\n\n' + finalContent;
                                    }
                                    if (agent === 'job_description_generator' || agent === 'job_ad_creator') {
                                        finalContent = replaceInventedCompany(finalContent);
                                        if (currentCompany) {
                                            finalContent = finalContent.replace(/\[Company Name\]/g, currentCompany)
                                                .replace(/\[company name\]/gi, currentCompany);
                                        }
                                    }

                                    // Clean up literal \n blocks and excessive spacing gaps
                                    if (typeof finalContent === 'string') {
                                        finalContent = finalContent
                                            .replace(/\\\\n/g, '\n')
                                            .replace(/\\n/g, '\n')
                                            .replace(/\n{3,}/g, '\n\n');
                                    }

                                    // Send a command to the frontend to overwrite the messy stream with the finalized clean text limit
                                    res.write(`data: ${JSON.stringify({ replaceText: finalContent })}\n\n`);

                                    if (agent === 'job_description_generator' || agent === 'job_ad_creator') {
                                        if (!sessionMemory.has(sessionId)) sessionMemory.set(sessionId, []);
                                        sessionMemory.get(sessionId).push({ role: 'assistant', content: finalContent });
                                    }
                                }
                            } catch (e) {
                                // Not valid JSON payload, keep what was streamed
                            }
                        }

                        // Error handling if agent stream errors mid-way
                        if (parsed.error) {
                            res.write(`data: ${JSON.stringify({ error: parsed.error })}\n\n`);
                            break;
                        }
                    } catch (parseErr) {
                        // Ignore partial or corrupted JSON lines
                    }
                }
            }
        }

        // Finalize SSE
        res.write('event: done\n');
        res.write('data: [DONE]\n\n');
        res.end();

    } catch (error) {
        console.error('Streaming API error:', error);
        res.write(`data: ${JSON.stringify({ error: 'Agent stream connection failed' })}\n\n`);
        res.end();
    }
};
