export async function modifyDocumentWithOpenAI(history, userMessage, res) {
    // Determine context string from history
    const contextLines = history.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n\n');

    const systemPrompt = `You are an expert HR and recruitment assistant. 
Your task is to review the user's latest request and modify the previous document (which is mostly likely a Job Description or Job Advertisement) exactly as requested.

Provide the FULL updated document. Keep the same overall structure and formatting (Markdown headers, bold text, etc) unless specifically asked to change it.
Do not wrap your response in "Here is the updated document" or "Sure, I can help". JUST output the modified document text directly.`;

    const requestBody = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is the conversation history and the document:\n\n${contextLines}\n\nNow, here is the new modification request from the user:\n\n${userMessage}` }
        ],
        stream: true
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`OpenAI API returned status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            
            if (trimmed.startsWith('data: ')) {
                const dataJson = trimmed.substring(6);
                try {
                    const parsed = JSON.parse(dataJson);
                    const token = parsed.choices[0]?.delta?.content;
                    if (token) {
                        res.write(`data: ${JSON.stringify({ text: token })}\n\n`);
                    }
                } catch (e) {
                    // Ignore parsing errors on partial chunks
                }
            }
        }
    }
}
