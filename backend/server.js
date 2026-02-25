import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Configuration for external APIs
const N8N_ROUTER_URL = process.env.N8N_ROUTER_URL || 'http://localhost:5678/webhook/route';
const AGENT_API_BASE_URL = process.env.AGENT_API_BASE_URL || 'http://localhost:8080';

const AGENT_CATALOG = {
    job_description_generator: {
        tenantId: process.env.JD_AGENT_TENANT_ID || 'replace-with-jd-tenant-id',
        configName: process.env.JD_AGENT_CONFIG_NAME || 'NMS Recruitment - JDG'
    },
    job_ad_creator: {
        tenantId: process.env.AD_AGENT_TENANT_ID || '662b3713ca2d41d89f0ffe5c6437f660',
        configName: process.env.AD_AGENT_CONFIG_NAME || 'NMS Recruitment - JAC'
    }
};

/**
 * 1. POST /route -> calls n8n router
 * N8n acts as an intent classifier and returns { "agent": "job_description_generator" | "job_ad_creator", "confidence": number }
 */
app.post('/route', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        console.log(message, sessionId);
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // 1. Call real n8n router
        const response = await fetch(N8N_ROUTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId })
        });
        console.log(response);
        if (!response.ok) {
            throw new Error(`n8n router returned status: ${response.status}`);
        }

        let data = {};
        const rawText = await response.text();

        try {
            data = JSON.parse(rawText);
        } catch (e) {
            console.error('N8N Router returned invalid JSON:', rawText);
        }

        // Safety check fallback
        if (!data || !data.agent) {
            console.warn('n8n returned missing/invalid agent property. Falling back to default.');
            data = { agent: 'job_description_generator', confidence: 0.5 };
        }

        return res.json(data);
    } catch (error) {
        console.error('Error calling n8n router:', error);
        return res.status(500).json({ error: 'Failed to route message' });
    }
});

/**
 * 2. GET /chat-stream -> streams agent response
 * Uses fetch to call agent SSE endpoint and pipes chunks to client
 */
app.get('/chat-stream', async (req, res) => {
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
    if (!agentConfig) {
        res.write(`data: ${JSON.stringify({ error: 'Invalid agent selected' })}\n\n`);
        return res.end();
    }

    try {
        let activeConfigurationId = configurationId;

        // 1. Call startConversation API ONLY if we haven't locked into a configuration ID for this topic yet
        if (!activeConfigurationId) {
            const startRes = await fetch(`${AGENT_API_BASE_URL}/api/startConversation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.AGENT_API_KEY}`
                },
                body: JSON.stringify({
                    tenantAgentId: agentConfig.tenantId,
                    configurationName: agentConfig.configName,
                    requestBodyJson: {
                        sessionId: sessionId,
                        message: message
                    }
                })
            });

            if (!startRes.ok) throw new Error(`Failed to start conversation: ${startRes.status}`);

            const startData = await startRes.json();
            activeConfigurationId = startData.agentChatConfigurationId;

            if (!activeConfigurationId) {
                throw new Error('No agentChatConfigurationId returned from Agent API');
            }

            // Immediately send back to frontend so it can save configurationId state
            res.write(`data: ${JSON.stringify({ configurationId: activeConfigurationId })}\n\n`);
        }

        // 2. Stream Agent Output using multipart form-data
        const formData = new FormData();
        formData.append('configurationId', activeConfigurationId);

        // Include userPrompt parameter on the stream call for all active agents
        formData.append('userPrompt', message);
        formData.append('sessionId', sessionId);

        const streamRes = await fetch(`${AGENT_API_BASE_URL}/api/1/chat/chat-stream`, {
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
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

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
                                .replace(/^\{|\}$/g, '')
                                .replace(/\\n/g, '\n');

                            if (sanitized.trim().length > 0) {
                                res.write(`data: ${JSON.stringify({ text: sanitized })}\n\n`);
                            }
                        }

                        // Fallback logic to process end-payload JSON safely
                        if (parsed.event === 'RunCompleted' && parsed.content) {
                            try {
                                // Sometimes the agent returns stringified JSON, e.g. "```json{...}```"
                                let cleanContent = parsed.content.replace(/^```json/g, '').replace(/```$/g, '').trim();

                                // Some LLMs double-string encode
                                if (cleanContent.startsWith('"') && cleanContent.endsWith('"')) {
                                    cleanContent = JSON.parse(cleanContent);
                                }

                                const structuredParsed = JSON.parse(cleanContent);

                                // If it successfully parses into the JobAdResponse schema
                                if (structuredParsed.response) {
                                    // Send a command to the frontend to overwrite the messy stream with the finalized clean text limit
                                    res.write(`data: ${JSON.stringify({ replaceText: structuredParsed.response })}\n\n`);
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
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
