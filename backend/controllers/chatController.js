import { determineIntent } from '../services/orchestratorService.js';
import { modifyDocumentWithOpenAI } from '../services/openaiService.js';
import { AGENT_CATALOG, AGENT_API_BASE_URL } from '../config/agents.js';

export const handleChatStream = async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const payload = req.method === 'POST' ? req.body : req.query;
    const { message, currentAgent, sessionId, configurationId, history = [] } = payload;
    
    console.log(`[${req.method}] message:`, message, 'agent:', currentAgent, 'session:', sessionId, 'config:', configurationId);
    
    if (!message || !sessionId) {
        res.write(`data: ${JSON.stringify({ error: 'Message and sessionId are required' })}\n\n`);
        return res.end();
    }

    try {
        let targetAgent = currentAgent;
        let activeConfigurationId = configurationId;

        // --- ORCHESTRATOR LOGIC ---
        // We evaluate intent on backend to see if we need to switch agents
        try {
            const intentData = await determineIntent(message, currentAgent);
            if (intentData.agent === 'modify_document') {
                try {
                    // Send back the agent identifier to the frontend
                    res.write(`data: ${JSON.stringify({ agent: 'modify_document' })}\n\n`);
                    await modifyDocumentWithOpenAI(history, message, res);
                    res.write('event: done\n');
                    res.write('data: [DONE]\n\n');
                    return res.end();
                } catch (modifyErr) {
                    console.error('Failed to run modifyDocumentWithOpenAI:', modifyErr);
                    res.write(`data: ${JSON.stringify({ error: 'Failed to modify document with AI' })}\n\n`);
                    return res.end();
                }
            } else if (intentData.agent !== 'unsupported_intent') {
                if (intentData.agent !== targetAgent) {
                    // Intent changed! Hand off to the new agent dynamically.
                    targetAgent = intentData.agent;
                    activeConfigurationId = null; // force a new conversation for the new agent
                }
            } else if (!targetAgent || targetAgent === 'null' || targetAgent === 'undefined') {
                // No prior agent, and current intent is unsupported
                res.write(`data: ${JSON.stringify({ 
                    text: "I'm a recruitment assistant. I can only help you to create job ads or job descriptions. What would you like to do?", 
                    isUnsupported: true 
                })}\n\n`);
                res.write('event: done\n');
                res.write('data: [DONE]\n\n');
                return res.end();
            }
        } catch (intentErr) {
            console.error('Failed to run orchestrator intent:', intentErr);
        }

        const agentConfig = AGENT_CATALOG[targetAgent];
        if (!agentConfig) {
            res.write(`data: ${JSON.stringify({ error: `Invalid agent selected: ${targetAgent}` })}\n\n`);
            return res.end();
        }

        // Tell frontend about the definitive agent state via the stream!
        res.write(`data: ${JSON.stringify({ agent: targetAgent })}\n\n`);

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
        
        // Define accumulators for parsing the LLM response safely
        let llmAccumulator = '';
        let sentResponseLength = 0;
        let generatedMessageEmitted = false;

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
                            llmAccumulator += parsed.content;
                            
                            const trimmedAccumulator = llmAccumulator.trimStart();
                            // If it clearly doesn't look like JSON or JSON-markdown, stream it as raw text
                            if (!trimmedAccumulator.startsWith('{') && !trimmedAccumulator.startsWith('```json')) {
                                res.write(`data: ${JSON.stringify({ text: parsed.content })}\n\n`);
                                continue;
                            }

                            // Emit a loading message if we're silently generating DRAFT_ADS or GENERATE_JD
                            if (!generatedMessageEmitted && (llmAccumulator.includes('"DRAFT_ADS"') || llmAccumulator.includes('"GENERATE_JD"'))) {
                                res.write(`data: ${JSON.stringify({ text: "*✨ Generating..." })}\n\n`);
                                generatedMessageEmitted = true;
                            }

                            // It seems to be building a JSON object. We want to extract the "response" field value.
                            const responseMatch = llmAccumulator.match(/"response"\s*:\s*"/);
                            if (responseMatch) {
                                const startIndex = responseMatch.index + responseMatch[0].length;
                                let currentResponseString = llmAccumulator.substring(startIndex);
                                
                                // Since we're streaming a JSON string, a closing quote marks the end.
                                // We need to find the first unescaped quote.
                                let endQuoteIndex = -1;
                                for (let i = 0; i < currentResponseString.length; i++) {
                                    if (currentResponseString[i] === '"') {
                                        let bslashes = 0;
                                        let j = i - 1;
                                        while (j >= 0 && currentResponseString[j] === '\\') {
                                            bslashes++;
                                            j--;
                                        }
                                        if (bslashes % 2 === 0) {
                                            endQuoteIndex = i;
                                            break;
                                        }
                                    }
                                }

                                if (endQuoteIndex !== -1) {
                                    currentResponseString = currentResponseString.substring(0, endQuoteIndex);
                                }

                                // Avoid parsing incomplete escape sequences at the end of the chunk
                                let trailingBackslashes = 0;
                                for (let i = currentResponseString.length - 1; i >= 0; i--) {
                                    if (currentResponseString[i] === '\\') {
                                        trailingBackslashes++;
                                    } else {
                                        break;
                                    }
                                }
                                
                                let safeString = currentResponseString;
                                if (trailingBackslashes % 2 !== 0) {
                                    safeString = safeString.substring(0, safeString.length - 1);
                                }

                                let unescaped = safeString
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\"/g, '"')
                                    .replace(/\\\\/g, '\\')
                                    .replace(/\\t/g, '\t')
                                    .replace(/\\r/g, '\r');

                                const newTextToSend = unescaped.substring(sentResponseLength);
                                if (newTextToSend.length > 0) {
                                    res.write(`data: ${JSON.stringify({ text: newTextToSend })}\n\n`);
                                    sentResponseLength = unescaped.length;
                                }
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
                                let finalOutput = '';

                                if (structuredParsed.action === 'DRAFT_ADS' && structuredParsed.platforms) {
                                    finalOutput = `# ${structuredParsed.jobTitle || 'Job Ad'}\n\n`;
                                    for (const [platform, adData] of Object.entries(structuredParsed.platforms)) {
                                        let adText = typeof adData === 'string' ? adData : (adData.description || adData.text || JSON.stringify(adData));
                                        finalOutput += `### ${platform.charAt(0).toUpperCase() + platform.slice(1)}\n${adText}\n\n`;
                                    }
                                } else if (structuredParsed.action === 'GENERATE_JD' && structuredParsed.jobDescription) {
                                    finalOutput = structuredParsed.jobDescription;
                                } else if (structuredParsed.response) {
                                    finalOutput = structuredParsed.response;
                                } else {
                                    // Fallback text if we just didn't expect this schema
                                    finalOutput = "*Here are the generated details:*\n\n" + "```json\n" + JSON.stringify(structuredParsed, null, 2) + "\n```";
                                }

                                if (finalOutput) {
                                    // Send a command to the frontend to overwrite the messy stream with the finalized clean text limit
                                    res.write(`data: ${JSON.stringify({ replaceText: finalOutput })}\n\n`);
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
