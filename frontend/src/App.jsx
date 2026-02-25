import { useState, useRef, useEffect } from 'react';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [configurationId, setConfigurationId] = useState(null);
  const messagesEndRef = useRef(null);

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

      // 1. Get the routing intent ONLY if we haven't locked into a topic yet
      if (!targetAgent) {
        const routeRes = await fetch(`${BACKEND_URL}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMessage, sessionId: targetSessionId })
        });

        if (!routeRes.ok) throw new Error('Routing failed');
        const routeData = await routeRes.json();

        targetAgent = routeData.agent;
        setActiveAgent(targetAgent); // Lock topic for future messages
      }

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
        eventSource.close();
        setIsLoading(false);
      };

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'agent', content: 'Sorry, something went wrong. Please try again.' }]);
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>AI Assistant</h2>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Hi! How can I help you today?</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`message-wrapper ${msg.role}`}>
            <div className={`message-bubble ${msg.role}`}>
              {msg.content}
            </div>

            {/* Show "Create Job Ad" button if the text has standard Job Description structures */}
            {idx === messages.length - 1 &&
              msg.role === 'agent' &&
              activeAgent === 'job_description_generator' &&
              !isLoading &&
              msg.content.length > 200 &&
              /responsibilities/i.test(msg.content) &&
              (/requirements/i.test(msg.content) || /qualifications/i.test(msg.content) || /skills/i.test(msg.content)) && (
                <div style={{ marginTop: '8px' }}>
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
          </div>
        ))}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <div className="message-wrapper agent">
            <div className="message-bubble agent typing">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export default App;
