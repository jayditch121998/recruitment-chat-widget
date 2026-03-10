import { useState, useRef, useEffect } from 'react';
import { BACKEND_URL } from '../App';

export const useChatLogic = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeAgent, setActiveAgent] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [configurationId, setConfigurationId] = useState(null);
    const [processSelection, setProcessSelection] = useState(null); // null, 'guided', 'manual'
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const sendMessage = async (userMessage, overrideAgent = null) => {
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);

        try {
            let targetAgent = overrideAgent || activeAgent;
            let targetSessionId = sessionId;

            // Generate a new sessionId if we don't have one active
            if (!targetSessionId) {
                targetSessionId = `session-hr-${Date.now()}`;
                setSessionId(targetSessionId);
            }

            let backendMessage = userMessage;

            // Add a placeholder for the agent's response
            setMessages(prev => [...prev, { role: 'agent', content: '' }]);

            // 1. Start the SSE stream bypassing N8N using the locked agent and session.
            const response = await fetch(`${BACKEND_URL}/chat-stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: backendMessage,
                    currentAgent: targetAgent,
                    sessionId: targetSessionId,
                    configurationId: configurationId,
                    history: messages.slice(-10) // send context for followups
                })
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const dataStr = line.replace(/^data:\s*/, '').trim();
                    if (!dataStr || dataStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(dataStr);

                        if (data.agent && data.agent !== 'modify_document') {
                            setActiveAgent(data.agent);
                        }

                        if (data.configurationId) {
                            setConfigurationId(data.configurationId);
                        }

                        if (data.isUnsupported) {
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastMessage = { ...newMessages[newMessages.length - 1] };
                                lastMessage.content = data.text;
                                lastMessage.isUnsupported = true;
                                newMessages[newMessages.length - 1] = lastMessage;
                                return newMessages;
                            });
                            reader.cancel();
                            setIsLoading(false);
                            break;
                        }

                        if (data.error) {
                            console.error('Stream Error:', data.error);
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastMsg = newMessages[newMessages.length - 1];
                                if (lastMsg && lastMsg.role === 'agent') {
                                    lastMsg.content = lastMsg.content ? `${lastMsg.content}\n\n**Error:** ${data.error}` : `**Error:** ${data.error}`;
                                } else {
                                    newMessages.push({ role: 'agent', content: `**Error:** ${data.error}` });
                                }
                                return newMessages;
                            });
                            reader.cancel();
                            setIsLoading(false);
                            break;
                        }

                        if (data.text) {
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastMessage = { ...newMessages[newMessages.length - 1] };
                                lastMessage.content += data.text.replace(/```json/g, '').replace(/```/g, '');
                                newMessages[newMessages.length - 1] = lastMessage;
                                return newMessages;
                            });
                        }

                        if (data.replaceText !== undefined) {
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastMessage = { ...newMessages[newMessages.length - 1] };
                                lastMessage.content = data.replaceText;
                                newMessages[newMessages.length - 1] = lastMessage;
                                return newMessages;
                            });
                        }
                    } catch (err) {
                        console.error('Error parsing stream data:', err, dataStr);
                    }
                }
            }

            setIsLoading(false);

        } catch (error) {
            console.error(error);
            setMessages(prev => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg && lastMsg.role === 'agent' && lastMsg.content === '') {
                    lastMsg.content = '**Error:** Sorry, something went wrong. Please try again.';
                } else if (lastMsg && lastMsg.role === 'agent') {
                    lastMsg.content += '\n\n**Error:** Sorry, something went wrong.';
                } else {
                    newMessages.push({ role: 'agent', content: '**Error:** Sorry, something went wrong. Please try again.' });
                }
                return newMessages;
            });
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        await sendMessage(userMessage);
    };

    return {
        messages,
        input,
        setInput,
        isLoading,
        activeAgent,
        setActiveAgent,
        sessionId,
        setSessionId,
        configurationId,
        setConfigurationId,
        processSelection,
        setProcessSelection,
        messagesEndRef,
        sendMessage,
        handleSubmit
    };
};
