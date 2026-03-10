import { useState, useEffect } from 'react';
import './App.css';
import { BotAvatar } from './components/Icons';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ChatInput } from './components/ChatInput';
import { MessageBubble } from './components/MessageBubble';
import { useChatLogic } from './hooks/useChatLogic';

const getEnvVar = (name, fallback) => {
    if (typeof window !== 'undefined' && window._env_ && window._env_[name] !== undefined) {
        return window._env_[name];
    }
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name] !== undefined) {
        return import.meta.env[name];
    }
    return fallback;
};

export const BACKEND_URL = getEnvVar('VITE_BACKEND_URL', 'http://localhost:3001');
const JD_AGENT_ACTIVE = getEnvVar('VITE_JD_AGENT_ACTIVE', 'true');
const AD_AGENT_ACTIVE = getEnvVar('VITE_AD_AGENT_ACTIVE', 'true');

function App() {
    const {
        messages,
        input,
        setInput,
        isLoading,
        activeAgent,
        setActiveAgent,
        setSessionId,
        setConfigurationId,
        processSelection,
        setProcessSelection,
        messagesEndRef,
        sendMessage,
        handleSubmit
    } = useChatLogic();

    const [activeAgentsConfig, setActiveAgentsConfig] = useState({
        job_description_generator: JD_AGENT_ACTIVE !== 'false',
        job_ad_creator: AD_AGENT_ACTIVE !== 'false'
    });

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

    return (
        <div className="chat-container">
            <div className="chat-header">
                <h2>Recruitment AI Assistant</h2>
            </div>

            <div className="chat-messages">
                {messages.length === 0 && (
                    <WelcomeScreen 
                        processSelection={processSelection}
                        setProcessSelection={setProcessSelection}
                        activeAgentsConfig={activeAgentsConfig}
                        setSessionId={setSessionId}
                        setActiveAgent={setActiveAgent}
                        setConfigurationId={setConfigurationId}
                        sendMessage={sendMessage}
                    />
                )}
                
                {messages.map((msg, idx) => (
                    <MessageBubble 
                        key={idx}
                        msg={msg}
                        idx={idx}
                        isLastMessage={idx === messages.length - 1}
                        isLoading={isLoading}
                        activeAgent={activeAgent}
                        activeAgentsConfig={activeAgentsConfig}
                        sendMessage={sendMessage}
                        setSessionId={setSessionId}
                        setActiveAgent={setActiveAgent}
                        setConfigurationId={setConfigurationId}
                    />
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

            <ChatInput 
                input={input}
                setInput={setInput}
                isLoading={isLoading}
                handleSubmit={handleSubmit}
                messagesLength={messages.length}
            />
        </div>
    );
}

export default App;
