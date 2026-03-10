import React, { useState } from 'react';
import { SparklesIcon } from './Icons';

export const WelcomeScreen = ({
    processSelection,
    setProcessSelection,
    activeAgentsConfig,
    setSessionId,
    setActiveAgent,
    setConfigurationId,
    sendMessage
}) => {
    const [formData, setFormData] = useState({
        title: '',
        department: '',
        experience: '',
        tasks: '',
        skills: ''
    });

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGuidedSubmit = (e) => {
        e.preventDefault();

        const generatedPrompt = `Please use the following details to generate a job description:
- Job Title: ${formData.title || 'Not specified'}
- Department: ${formData.department || 'Not specified'}
- Experience level: ${formData.experience || 'Not specified'}
- Key tasks: ${formData.tasks || 'Not specified'}
- Required skills: ${formData.skills || 'Not specified'}

Let's create a full job profile step-by-step. First, generate the detailed Job Description based on these details.`;

        setSessionId(`session-hr-${Date.now()}`);
        setActiveAgent('job_description_generator');
        setConfigurationId(null);
        sendMessage(generatedPrompt, 'job_description_generator');
    };

    return (
        <div className="empty-state">
            <SparklesIcon />
            <h3 style={{ marginBottom: '8px', color: 'var(--text-main)', fontWeight: 600 }}>Welcome!</h3>

            {!processSelection ? (
                <>
                    <p style={{ marginBottom: '24px' }}>How would you like to proceed?</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '450px', margin: '0 auto' }}>
                        <div
                            onClick={() => {
                                setProcessSelection('guided');
                            }}
                            className="workflow-card"
                        >
                            <div className="workflow-card-content">
                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    🚀 Step-by-Step Guide
                                </h4>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                    Fill out a quick form, generate a formal Job Description, and then automatically create a marketing-style Job Ad right after.
                                </p>
                            </div>
                            <div className="workflow-card-arrow">→</div>
                        </div>

                        <div
                            onClick={() => setProcessSelection('manual')}
                            className="workflow-card"
                        >
                            <div className="workflow-card-content">
                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    🛠️ Manual Mode
                                </h4>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                    Choose exactly what you want to create and direct the AI manually. Best for quick edits or single-document generation.
                                </p>
                            </div>
                            <div className="workflow-card-arrow">→</div>
                        </div>
                    </div>
                </>
            ) : processSelection === 'guided' ? (
                <div style={{ maxWidth: '500px', width: '100%', margin: '0 auto', textAlign: 'left', background: 'var(--chat-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
                    <h4 style={{ marginTop: 0, marginBottom: '6px', color: 'var(--text-main)', fontSize: '1.1rem' }}>Job Requirements</h4>
                    <p style={{ margin: 0, marginBottom: '20px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Fill in the details below to kickstart the AI generation.</p>
                    <form onSubmit={handleGuidedSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>Job Title *</label>
                            <input required type="text" name="title" value={formData.title} onChange={handleInputChange} placeholder="e.g. Senior AI Engineer" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.95rem' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>Department *</label>
                                <input required type="text" name="department" value={formData.department} onChange={handleInputChange} placeholder="e.g. Engineering" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.95rem' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>Experience Level *</label>
                                <input required type="text" name="experience" value={formData.experience} onChange={handleInputChange} placeholder="e.g. Mid-level" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.95rem' }} />
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>Key Tasks *</label>
                            <textarea required name="tasks" value={formData.tasks} onChange={handleInputChange} placeholder="e.g. Develop AI models, optimize LLM inference, design agentic workflows" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-main)', minHeight: '80px', fontFamily: 'inherit', fontSize: '0.95rem', resize: 'vertical' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>Required Skills *</label>
                            <textarea required name="skills" value={formData.skills} onChange={handleInputChange} placeholder="e.g. Python, PyTorch, Node.js, Prompt Engineering" style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-main)', minHeight: '80px', fontFamily: 'inherit', fontSize: '0.95rem', resize: 'vertical' }} />
                        </div>

                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                            <button type="submit" className="action-button" style={{ flex: 1, justifyContent: 'center' }}>
                                Start Generation ✨
                            </button>
                            <button type="button" onClick={() => setProcessSelection(null)} className="action-button outline" style={{ flex: 1, justifyContent: 'center' }}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            ) : processSelection === 'manual' ? (
                <>
                    <p style={{ marginBottom: '24px' }}>I'm your AI Recruitment Assistant. What would you like to create?</p>
                    <div className="action-buttons-container" style={{ justifyContent: 'center' }}>
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

                    </div>
                    <div style={{ marginTop: '32px' }}>
                        <button
                            onClick={() => setProcessSelection(null)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
                        >
                            ← Back to process selection
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    );
};
