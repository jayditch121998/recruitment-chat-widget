import React from 'react';
import { SendIcon } from './Icons';

export const ChatInput = ({
    input,
    setInput,
    isLoading,
    handleSubmit,
    messagesLength
}) => {
    return (
        <div className="chat-input-wrapper">
            {messagesLength > 0 && (
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
    );
};
