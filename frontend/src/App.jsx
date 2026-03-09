import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const getEnvVar = (name, fallback) => {
    if (typeof window !== 'undefined' && window._env_ && window._env_[name] !== undefined) {
        return window._env_[name];
    }
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name] !== undefined) {
        return import.meta.env[name];
    }
    return fallback;
};

const BACKEND_URL = getEnvVar('VITE_BACKEND_URL', 'http://localhost:3001');
const JD_AGENT_ACTIVE = getEnvVar('VITE_JD_AGENT_ACTIVE', 'true');
const AD_AGENT_ACTIVE = getEnvVar('VITE_AD_AGENT_ACTIVE', 'true');

const BotAvatar = () => (
    <div className="avatar agent">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
    </div>
);

const UserAvatar = () => (
    <div className="avatar user">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
    </div>
);

const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="11" y1="2" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);

const SparklesIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "12px" }}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /><path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" /></svg>
);

function App() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeAgent, setActiveAgent] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [configurationId, setConfigurationId] = useState(null);
    const [activeAgentsConfig, setActiveAgentsConfig] = useState({
        job_description_generator: JD_AGENT_ACTIVE !== 'false',
        job_ad_creator: AD_AGENT_ACTIVE !== 'false'
    });
    const messagesEndRef = useRef(null);

    useEffect(() => {
        fetch(`${BACKEND_URL}/agents`)
            .then(res => res.json())
            .then(data => {
                setActiveAgentsConfig({
                    job_description_generator: JD_AGENT_ACTIVE !== 'false' && data.job_description_generator !== false,
                    job_ad_creator: AD_AGENT_ACTIVE !== 'false' && data.job_ad_creator !== false
                });
            })
            .catch(err => console.error("Failed to fetch agent config", err));
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');
        await sendMessage(userMessage);
    };

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

            // 1. Get the routing intent for EVERY message
            const routeRes = await fetch(`${BACKEND_URL}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage, sessionId: targetSessionId, activeAgent: targetAgent })
            });

            if (!routeRes.ok) throw new Error('Routing failed');
            const routeData = await routeRes.json();

            targetAgent = routeData.agent;

            if (targetAgent === 'unsupported_intent') {
                setMessages(prev => [...prev, {
                    role: 'agent',
                    content: "I'm a recruitment assistant. I can only help you to create job ads or job descriptions. What would you like to do?",
                    isUnsupported: true
                }]);
                setIsLoading(false);
                return;
            }

            setActiveAgent(targetAgent); // Keep track of the resolved agent



            // Add a placeholder for the agent's response
            setMessages(prev => [...prev, { role: 'agent', content: '' }]);

            // 2. Start the SSE stream bypassing N8N using the locked agent and session
            let streamUrl = `${BACKEND_URL}/chat-stream?message=${encodeURIComponent(userMessage)}&agent=${encodeURIComponent(targetAgent)}&sessionId=${encodeURIComponent(targetSessionId)}`;
            if (configurationId) {
                streamUrl += `&configurationId=${encodeURIComponent(configurationId)}`;
            }

            const eventSource = new EventSource(streamUrl);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.configurationId) {
                        setConfigurationId(data.configurationId);
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
                        eventSource.close();
                        setIsLoading(false);
                        return;
                    }

                    if (data.text) {
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastMessage = { ...newMessages[newMessages.length - 1] };
                            // Ensure we aren't appending '```json ' or similar artifacts directly into chat bubbles
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
                    console.error('Error parsing SSE data:', err);
                }
            };

            eventSource.addEventListener('done', () => {
                eventSource.close();
                setIsLoading(false);
            });

            eventSource.onerror = (err) => {
                console.error('EventSource failed:', err);
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'agent' && lastMsg.content === '') {
                        lastMsg.content = '**Error:** Connection lost. Please try again.';
                    } else if (lastMsg && lastMsg.role === 'agent') {
                        lastMsg.content += '\n\n**Error:** Connection lost.';
                    }
                    return newMessages;
                });
                eventSource.close();
                setIsLoading(false);
            };

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

    return (
        <div className="chat-container">
            <div className="chat-header">
                <h2>Recruitment AI Assistant</h2>
            </div>

            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="empty-state">
                        <SparklesIcon />
                        <h3 style={{ marginBottom: '8px', color: 'var(--text-main)', fontWeight: 600 }}>Welcome!</h3>
                        <p style={{ marginBottom: '24px' }}>I&apos;m your AI Recruitment Assistant. How can I help you today?</p>
                        <div className="action-buttons-container" style={{ justifyContent: 'center' }}>
                            {activeAgentsConfig.job_ad_creator && (
                                <button
                                    className="action-button outline"
                                    onClick={() => {
                                        setSessionId(`session-hr-${Date.now()}`);
                                        setActiveAgent('job_ad_creator');
                                        setConfigurationId(null);
                                        sendMessage("I would like to create a job ad.", 'job_ad_creator');
                                    }}
                                >
                                    📝 Create a Job Ad
                                </button>
                            )}
                            {activeAgentsConfig.job_description_generator && (
                                <button
                                    className="action-button outline"
                                    onClick={() => {
                                        setSessionId(`session-hr-${Date.now()}`);
                                        setActiveAgent('job_description_generator');
                                        setConfigurationId(null);
                                        sendMessage("I would like to create a job description.", 'job_description_generator');
                                    }}
                                >
                                    📋 Create a Job Description
                                </button>
                            )}
                        </div>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`message-wrapper ${msg.role}`}>
                        {msg.role === 'agent' && <BotAvatar />}
                        <div className={`message-column ${msg.role}`}>
                            <div
                                className={`message-bubble ${msg.role} ${msg.role === 'agent' && !msg.content && isLoading && idx === messages.length - 1 ? 'typing' : ''
                                    }`}
                            >
                                {msg.role === 'agent' && !msg.content && isLoading && idx === messages.length - 1 ? (
                                    <>
                                        <span className="dot"></span>
                                        <span className="dot"></span>
                                        <span className="dot"></span>
                                    </>
                                ) : (
                                    <ReactMarkdown
                                        components={{
                                            a: ({ href, children, ...props }) => {
                                                if (href && href.startsWith('#action:')) {
                                                    const actionText = decodeURIComponent(href.replace('#action:', ''));
                                                    return (
                                                        <button
                                                            className="option-chip"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                if (!isLoading) {
                                                                    sendMessage(actionText);
                                                                }
                                                            }}
                                                        >
                                                            {children}
                                                        </button>
                                                    );
                                                }
                                                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                                            }
                                        }}
                                    >
                                        {(msg.content || '')
                                            .replace(/\\\\n/g, '\n')
                                            .replace(/\\n/g, '\n')
                                            .replace(/\n{3,}/g, '\n\n')
                                            .replace(/\n+(?=\s*(?:[*-]|\d+\.)\s)/g, '\n')
                                            .replace(/(^|[\s(>*])(["'])(.+?)\2(?=[.,;:\s)!?*]|$)/g, (match, p1, p2, p3) => {
                                                if (p3.length > 80 || p3.includes('\n')) return match;
                                                return `${p1}[${p3}](#action:${encodeURIComponent(p3)})`;
                                            })}
                                    </ReactMarkdown>
                                )}
                            </div>

                            {/* Show "Create Job Ad" button if the text has standard Job Description structures */}
                            {idx === messages.length - 1 &&
                                msg.role === 'agent' &&
                                activeAgent === 'job_description_generator' &&
                                activeAgentsConfig.job_ad_creator &&
                                !isLoading &&
                                msg.content.length > 200 &&
                                /responsibilities/i.test(msg.content) &&
                                (/requirements/i.test(msg.content) || /qualifications/i.test(msg.content) || /skills/i.test(msg.content)) && (
                                    <div className="action-buttons-container">
                                        <button
                                            className="action-button"
                                            onClick={() => {
                                                // Reset session to cleanly handoff to ad creator
                                                setSessionId(`session-hr-${Date.now()}`);
                                                setActiveAgent('job_ad_creator');
                                                setConfigurationId(null);
                                                sendMessage("Yes please, create a Job Ad from this job description:\n\n" + msg.content, 'job_ad_creator');
                                            }}
                                        >
                                            ✨ Generate Job Ad from this
                                        </button>
                                    </div>
                                )}

                            {msg.isUnsupported && (
                                <div className="action-buttons-container">
                                    {activeAgentsConfig.job_ad_creator && (
                                        <button
                                            className="action-button outline"
                                            disabled={idx !== messages.length - 1 || isLoading}
                                            onClick={() => {
                                                setSessionId(`session-hr-${Date.now()}`);
                                                setActiveAgent('job_ad_creator');
                                                setConfigurationId(null);
                                                sendMessage("I would like to create a job ad.", 'job_ad_creator');
                                            }}
                                        >
                                            📝 Create a Job Ad
                                        </button>
                                    )}
                                    {activeAgentsConfig.job_description_generator && (
                                        <button
                                            className="action-button outline"
                                            disabled={idx !== messages.length - 1 || isLoading}
                                            onClick={() => {
                                                setSessionId(`session-hr-${Date.now()}`);
                                                setActiveAgent('job_description_generator');
                                                setConfigurationId(null);
                                                sendMessage("I would like to create a job description.", 'job_description_generator');
                                            }}
                                        >
                                            📋 Create a Job Description
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        {msg.role === 'user' && <UserAvatar />}
                    </div>
                ))}
                {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                    <div className="message-wrapper agent">
                        <BotAvatar />
                        <div className="message-column agent">
                            <div className="message-bubble agent typing">
                                <span className="dot"></span>
                                <span className="dot"></span>
                                <span className="dot"></span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-wrapper">
                {messages.length > 0 && (
                    <div style={{ textAlign: 'center', marginBottom: '10px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        💡 Tip: You can tap the highlighted options in replies!
                    </div>
                )}
                <form className="chat-input-form" onSubmit={handleSubmit}>
                    <textarea
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            // Auto resize
                            e.target.style.height = 'auto';
                            const scrollHeight = e.target.scrollHeight;
                            e.target.style.height = `${Math.min(scrollHeight, 120)}px`;
                            e.target.style.overflowY = scrollHeight > 120 ? 'auto' : 'hidden';
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (!isLoading && input.trim()) {
                                    handleSubmit(e);
                                    e.target.style.height = 'auto'; // Reset height on submit
                                    e.target.style.overflowY = 'hidden'; // Hide scrollbar again
                                }
                            }
                        }}
                        placeholder="Type your message..."
                        autoFocus
                        rows={1}
                    />
                    <button type="submit" className="send-btn" disabled={isLoading || !input.trim()}>
                        <SendIcon />
                    </button>
                </form>
            </div>
        </div>
    );
}

export default App;
