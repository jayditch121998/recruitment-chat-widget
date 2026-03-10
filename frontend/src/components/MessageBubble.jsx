import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BotAvatar, UserAvatar, CopyIcon, CheckIcon } from './Icons';

const stripMarkdown = (markdown) => {
    if (!markdown) return '';
    return markdown
        // Remove bold, italics, strikethrough
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        // Remove headers
        .replace(/^\s*#+\s*/gm, '')
        // Remove links
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove images
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        // Remove inline code and code blocks
        .replace(/`([^`]+)`/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        // Remove blockquotes
        .replace(/^\s*>\s*/gm, '')
        // Remove horizontal rules
        .replace(/^(?:[-*_]\s*){3,}/gm, '')
        // Cleanup extra newlines from stripped markdown elements
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const MessageBubble = ({
    msg,
    idx,
    isLastMessage,
    isLoading,
    activeAgent,
    activeAgentsConfig,
    sendMessage,
    setSessionId,
    setActiveAgent,
    setConfigurationId
}) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = () => {
        if (!msg.content) return;
        const plainText = stripMarkdown(msg.content);
        navigator.clipboard.writeText(plainText).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    return (
        <div className={`message-wrapper ${msg.role}`}>
            {msg.role === 'agent' && <BotAvatar />}
            <div className={`message-column ${msg.role}`}>
                <div
                    className={`message-bubble ${msg.role} ${msg.role === 'agent' && !msg.content && isLoading && isLastMessage ? 'typing' : ''
                        }`}
                >
                    {msg.role === 'agent' && msg.content && (
                        <button
                            className="copy-button"
                            onClick={handleCopy}
                            title="Copy message"
                            aria-label="Copy to clipboard"
                        >
                            {isCopied ? <CheckIcon /> : <CopyIcon />}
                        </button>
                    )}

                    {msg.role === 'agent' && !msg.content && isLoading && isLastMessage ? (
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

                                    const text = p3.trim();
                                    const words = text.split(/\s+/).length;
                                    const isActionWord = /^(yes|no|skip|stop|continue|cancel)$/i.test(text);
                                    const hasActionVerb = /^(fill|use|generate|create|skip|proceed|ignore)/i.test(text);

                                    // If it's a short quote (1-2 words) usually it's a conversational quote like a job title or location.
                                    // We only turn it into a button if it's clearly an action command.
                                    if (words <= 2 && !isActionWord && !hasActionVerb) {
                                        return match;
                                    }
                                    // Also ignore quotes that were clearly preceding by a descriptive article/preposition
                                    // which means it's a noun. e.g. 'for a "Backend Programmer"'
                                    if (p1 && /(?:for|a|an|the|as) $/i.test(p1)) {
                                        return match;
                                    }

                                    return `${p1}[${p3}](#action:${encodeURIComponent(p3)})`;
                                })}
                        </ReactMarkdown>
                    )}
                </div>

                {/* Show "Create Job Ad" button if the text has standard Job Description structures */}
                {isLastMessage &&
                    msg.role === 'agent' &&
                    activeAgent === 'job_description_generator' &&
                    activeAgentsConfig.job_ad_creator &&
                    !isLoading &&
                    msg.content.length > 500 &&
                    !/provide|tell me|what is|information|could you|need a few details/i.test(msg.content) &&
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
                        {activeAgentsConfig.job_description_generator && (
                            <button
                                className="action-button outline"
                                disabled={!isLastMessage || isLoading}
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
                        {activeAgentsConfig.job_ad_creator && (
                            <button
                                className="action-button outline"
                                disabled={!isLastMessage || isLoading}
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
                    </div>
                )}
            </div>
            {msg.role === 'user' && <UserAvatar />}
        </div>
    );
};
